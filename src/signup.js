// Client for the MailChannels signup API (POST /signup and /signup/claim).
// See https://docs.mailchannels.com/email-api/signup-api

export const DEFAULT_SIGNUP_API_URL = 'https://dash.mailchannels.com/api/v1'
export const SIGNUP_SOURCE = 'cloudflare-plugin'

export class SignupApiError extends Error {
  constructor(message, { status, code, retryAfter, upgradeUrl } = {}) {
    super(message)
    this.name = 'SignupApiError'
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
    this.upgradeUrl = upgradeUrl
  }
}

export class ClaimTimeoutError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ClaimTimeoutError'
  }
}

/**
 * Requests a free account. Resolves to the 202 body, which always has a
 * `claim_token` whether or not an account was created.
 */
export async function requestSignup({ apiUrl = DEFAULT_SIGNUP_API_URL, email, domain, turnstileToken, source = SIGNUP_SOURCE, fetch = globalThis.fetch }) {
  const body = { email, turnstile_token: turnstileToken, source }
  if (domain) body.domain = domain
  const { status, json, headers } = await postJson(fetch, `${trimSlash(apiUrl)}/signup`, body)
  if (status === 202 && json && typeof json.claim_token === 'string') return json
  throw apiError(status, json, headers)
}

/**
 * Tries the claim once. Resolves to `{ ready: true, ...body }` with the API key,
 * or `{ ready: false, ...body }` while the address is unverified.
 */
export async function claimOnce({ apiUrl = DEFAULT_SIGNUP_API_URL, claimToken, fetch = globalThis.fetch }) {
  const { status, json, headers } = await postJson(fetch, `${trimSlash(apiUrl)}/signup/claim`, { claim_token: claimToken })
  if (status === 200 && json && typeof json.api_key === 'string') return { ready: true, ...json }
  if (status === 202) return { ready: false, ...(json || {}) }
  throw apiError(status, json, headers)
}

/**
 * Polls the claim operation until the address is verified, the timeout passes,
 * or the API returns an error other than a rate limit.
 */
export async function waitForClaim({
  apiUrl,
  claimToken,
  fetch,
  intervalMs = 5000,
  timeoutMs = 30 * 60 * 1000,
  sleep = defaultSleep,
  now = Date.now,
  onPending = () => {},
}) {
  const deadline = now() + timeoutMs
  for (;;) {
    let waitMs = intervalMs
    try {
      const result = await claimOnce({ apiUrl, claimToken, fetch })
      if (result.ready) return result
      onPending(result)
    }
    catch (error) {
      if (!(error instanceof SignupApiError) || error.status !== 429) throw error
      waitMs = Math.max(intervalMs, (error.retryAfter || 0) * 1000)
    }
    if (now() + waitMs > deadline) {
      throw new ClaimTimeoutError('Timed out waiting for the email address to be verified. Run init again to restart signup; the claim token expires after 72 hours.')
    }
    await sleep(waitMs)
  }
}

async function postJson(fetch, url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body),
  })
  let json = null
  try {
    json = await response.json()
  }
  catch {
    // Non-JSON bodies are reported by status alone.
  }
  return { status: response.status, json, headers: response.headers }
}

function apiError(status, json, headers) {
  const code = json && typeof json.error === 'string' ? json.error : undefined
  const retryAfter = Number.parseInt(headers?.get?.('retry-after') ?? '', 10)
  const message = json && typeof json.message === 'string'
    ? json.message
    : status === 404
      ? 'The signup API is not available at this URL (HTTP 404). It may not be enabled yet.'
      : `The signup API returned HTTP ${status}.`
  return new SignupApiError(message, {
    status,
    code,
    retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
    upgradeUrl: json?.upgrade_url,
  })
}

function trimSlash(url) {
  return url.replace(/\/+$/, '')
}

function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
