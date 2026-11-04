// The `init` command: create a free MailChannels account through the signup
// API, wait for the email address to be verified, and store the API key.
import { join, resolve } from 'node:path'
import { API_KEY_BINDING, DEFAULT_UPGRADE_URL } from './index.js'
import { ensureGitignored, upsertDevVar, wranglerSecretPut } from './secrets.js'
import { DEFAULT_SIGNUP_API_URL, requestSignup, SignupApiError, waitForClaim } from './signup.js'
import { DEFAULT_TURNSTILE_SITEKEY, openBrowser, startChallengeServer } from './turnstile.js'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Runs init. Every side effect (network, prompts, browser, wrangler, output)
 * comes from `deps` so tests can drive the whole flow.
 */
export async function runInit(options, deps = {}) {
  const {
    fetch = globalThis.fetch,
    log = console.log,
    prompt,
    secretPut = wranglerSecretPut,
    challenge = startChallengeServer,
    open = openBrowser,
    sleep,
  } = deps
  const cwd = resolve(options.cwd || '.')
  const apiUrl = options.apiUrl || DEFAULT_SIGNUP_API_URL

  let email = options.email
  if (!email && prompt) email = (await prompt('Email address for your MailChannels account: ')).trim()
  if (!email || !EMAIL.test(email)) throw new UsageError('A valid --email is required.')
  const domain = options.domain || email.split('@')[1]

  const turnstileToken = options.turnstileToken || await browserChallenge({
    sitekey: options.turnstileSitekey || DEFAULT_TURNSTILE_SITEKEY,
    challenge,
    open: options.open === false ? null : open,
    log,
  })

  log(`Requesting a free MailChannels account for ${email}...`)
  const pending = await requestSignup({ apiUrl, email, domain, turnstileToken, fetch })
  const upgradeUrl = pending.upgrade_url || DEFAULT_UPGRADE_URL
  log(`Check ${email} for a verification email from MailChannels and click the link.`)
  log('If you already have a MailChannels account, no email arrives: sign in at https://dash.mailchannels.com and create an API key there instead.')
  log('Waiting for verification (Ctrl+C to stop)...')

  const ready = await waitForClaim({
    apiUrl,
    claimToken: pending.claim_token,
    fetch,
    intervalMs: (options.pollInterval ?? 5) * 1000,
    timeoutMs: (options.timeout ?? 30) * 60 * 1000,
    ...(sleep ? { sleep } : {}),
  })
  log(`Email verified. Account ${ready.account_id} is on the free plan (${ready.free_plan_monthly_limit ?? pending.free_plan_monthly_limit} emails/month).`)

  const stored = []
  if (options.devVars !== false) {
    const path = join(cwd, '.dev.vars')
    await upsertDevVar(path, API_KEY_BINDING, ready.api_key)
    if (upgradeUrl !== DEFAULT_UPGRADE_URL) await upsertDevVar(path, 'MAILCHANNELS_UPGRADE_URL', upgradeUrl)
    if (await ensureGitignored(cwd)) log('Added .dev.vars to .gitignore.')
    stored.push('.dev.vars')
  }
  if (options.secret || options.pagesProject) {
    await secretPut({ name: API_KEY_BINDING, value: ready.api_key, cwd, pagesProject: options.pagesProject, env: options.env })
    stored.push(options.pagesProject ? `Pages secret on ${options.pagesProject}` : 'Worker secret')
  }
  log(`Stored ${API_KEY_BINDING} in ${stored.join(' and ') || 'nothing (--no-dev-vars without --secret)'}.`)
  if (!stored.length) log('Copy the key from the web app instead; init does not print it.')

  log('')
  log(`Before your first send, add this DNS record so MailChannels accepts mail from ${domain} (Domain Lockdown):`)
  log(`  _mailchannels.${domain}  TXT  "v=mc1 auth=${ready.account_id}"`)
  log(`Free plan limit reached? Upgrade at ${upgradeUrl}`)
  return { accountId: ready.account_id, upgradeUrl, stored }
}

export class UsageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UsageError'
  }
}

/** Formats an init failure for the terminal. */
export function describeError(error) {
  if (error instanceof SignupApiError) {
    const hints = {
      turnstile_failed: 'The browser check failed or expired. Run init again.',
      signup_rejected: 'Sign up at https://dash.mailchannels.com instead.',
      rate_limited: `Too many signups; try again${error.retryAfter ? ` in ${error.retryAfter} seconds` : ' later'}.`,
    }
    return [error.message, hints[error.code]].filter(Boolean).join(' ')
  }
  return error.message
}

async function browserChallenge({ sitekey, challenge, open, log }) {
  const { url, token, close } = await challenge({ sitekey })
  try {
    log(`Complete the signup check in your browser: ${url}`)
    open?.(url)
    return await token
  }
  finally {
    close()
  }
}
