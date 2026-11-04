import { MailChannels } from 'mailchannels-sdk'

export const DEFAULT_UPGRADE_URL = 'https://dash.mailchannels.com/billing'
export const API_KEY_BINDING = 'MAILCHANNELS_API_KEY'

// Statuses that cannot mean "the account is at its monthly limit", so a send
// refused with one of them is returned as-is without a usage lookup.
const NOT_A_LIMIT_STATUSES = new Set([400, 401, 413, 415, 422])
const LIMIT_MESSAGE = /quota|limit (?:exceeded|reached)/i

/**
 * Creates a sender for the MailChannels Email API.
 *
 * `send` returns `{ data, error }` like the SDK. When the account has used its
 * monthly allowance, `error.type` is `limit_reached` and `error.upgradeUrl`
 * says where to upgrade, instead of the bare refusal.
 */
export function createMailChannels(options = {}) {
  const { apiKey, baseUrl, upgradeUrl = DEFAULT_UPGRADE_URL, timeout } = options
  if (!apiKey) {
    // Report the missing key from send() rather than throwing, so a Pages site
    // without the secret still serves its other routes and assets.
    const missing = async () => ({ data: null, error: missingKeyError() })
    return { client: null, send: missing, usage: missing, upgradeUrl }
  }
  const client = new MailChannels(apiKey, {
    ...(baseUrl ? { baseUrl } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
  })

  async function usage() {
    return client.metrics.usage()
  }

  async function send(message, dryRun = false) {
    const result = await client.emails.send(message, dryRun)
    const status = result.error?.statusCode
    if (!result.error || status == null || NOT_A_LIMIT_STATUSES.has(status)) {
      return result
    }
    const limit = await limitError(result.error, usage, upgradeUrl)
    return limit ? { data: null, error: limit } : result
  }

  return { client, send, usage, upgradeUrl }
}

/**
 * Creates a sender from Worker bindings: the `MAILCHANNELS_API_KEY` secret and
 * the optional `MAILCHANNELS_BASE_URL` and `MAILCHANNELS_UPGRADE_URL` vars.
 * Explicit options win over bindings.
 */
export function fromEnv(env = {}, options = {}) {
  return createMailChannels({
    apiKey: env[API_KEY_BINDING],
    baseUrl: env.MAILCHANNELS_BASE_URL || undefined,
    upgradeUrl: env.MAILCHANNELS_UPGRADE_URL || undefined,
    ...stripUndefined(options),
  })
}

function missingKeyError() {
  return {
    type: 'missing_api_key',
    message: `Missing MailChannels API key. Run "npx cloudflare-mailchannels init", or set the ${API_KEY_BINDING} secret.`,
    statusCode: null,
    response: null,
  }
}

/** True when `error` is the plugin's monthly-limit error. */
export function isLimitError(error) {
  return Boolean(error) && error.type === 'limit_reached'
}

async function limitError(sendError, usage, upgradeUrl) {
  let current = null
  try {
    const { data } = await usage()
    if (data && typeof data.total === 'number' && typeof data.monthlyLimit === 'number') {
      current = { total: data.total, monthlyLimit: data.monthlyLimit }
    }
  }
  catch {
    // The usage lookup is best effort; fall back to the refusal's own text.
  }
  const overLimit = current
    ? current.monthlyLimit >= 0 && current.total >= current.monthlyLimit
    : LIMIT_MESSAGE.test(sendError.message || '')
  if (!overLimit) return null
  const used = current ? ` (${current.total} of ${current.monthlyLimit} emails used this period)` : ''
  return {
    type: 'limit_reached',
    message: `MailChannels refused the send because this account has reached its monthly sending limit${used}. Upgrade to a paid plan at ${upgradeUrl}`,
    statusCode: sendError.statusCode,
    upgradeUrl,
    usage: current,
    response: sendError.response,
    cause: sendError,
  }
}

function stripUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined))
}
