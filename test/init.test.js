import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { describeError, runInit } from '../src/init.js'
import { SignupApiError } from '../src/signup.js'
import { stubServer } from './helpers/stub-server.js'

const run = promisify(execFile)
const pending = { status: 'verification_pending', message: 'm', claim_token: 'claim-1', claim_url: '/api/v1/signup/claim', free_plan_monthly_limit: 3000, upgrade_url: 'https://dash.mailchannels.com/billing' }
const ready = { status: 'ready', message: 'm', api_key: 'SECRET-KEY-123', account_id: 'acct42', free_plan_monthly_limit: 3000, upgrade_url: 'https://dash.mailchannels.com/billing' }

function signupApi({ pendingClaims = 1, upgradeUrl } = {}) {
  let claims = 0
  return stubServer({
    'POST /api/v1/signup': () => ({ status: 202, json: { ...pending, ...(upgradeUrl ? { upgrade_url: upgradeUrl } : {}) } }),
    'POST /api/v1/signup/claim': () => (claims++ < pendingClaims
      ? { status: 202, json: { status: 'verification_pending' } }
      : { status: 200, json: ready }),
  })
}

let server
afterEach(() => server?.close())

describe('runInit', () => {
  it('signs up, waits for verification and writes .dev.vars without printing the key', async () => {
    server = await signupApi()
    const cwd = await mkdtemp(join(tmpdir(), 'cfmc-init-'))
    await writeFile(join(cwd, '.gitignore'), 'node_modules\n')
    const lines = []
    const result = await runInit(
      { email: 'dev@example.com', turnstileToken: 'tok', apiUrl: `${server.url}/api/v1`, cwd },
      { log: l => lines.push(l), sleep: async () => {} },
    )
    expect(result).toMatchObject({ accountId: 'acct42', stored: ['.dev.vars'] })
    expect(await readFile(join(cwd, '.dev.vars'), 'utf8')).toBe('MAILCHANNELS_API_KEY=SECRET-KEY-123\n')
    expect(await readFile(join(cwd, '.gitignore'), 'utf8')).toContain('.dev.vars')
    expect(server.requests[0].body).toMatchObject({ email: 'dev@example.com', domain: 'example.com', source: 'cloudflare-plugin' })
    expect(server.requests.filter(r => r.path.endsWith('/claim'))).toHaveLength(2)
    const output = lines.join('\n')
    expect(output).not.toContain('SECRET-KEY-123')
    expect(output).toContain('_mailchannels.example.com  TXT  "v=mc1 auth=acct42"')
    expect(output).toContain('https://dash.mailchannels.com/billing')
  })

  it('stores a Worker secret and a non-default upgrade URL', async () => {
    server = await signupApi({ pendingClaims: 0, upgradeUrl: 'https://test.example/billing' })
    const cwd = await mkdtemp(join(tmpdir(), 'cfmc-init-'))
    const puts = []
    await runInit(
      { email: 'dev@example.com', domain: 'mail.example.com', turnstileToken: 'tok', apiUrl: `${server.url}/api/v1`, cwd, secret: true, env: 'production' },
      { log: () => {}, secretPut: async p => puts.push(p) },
    )
    expect(puts).toEqual([{ name: 'MAILCHANNELS_API_KEY', value: 'SECRET-KEY-123', cwd, pagesProject: undefined, env: 'production' }])
    expect(await readFile(join(cwd, '.dev.vars'), 'utf8')).toBe('MAILCHANNELS_API_KEY=SECRET-KEY-123\nMAILCHANNELS_UPGRADE_URL=https://test.example/billing\n')
  })

  it('gets the Turnstile token from the browser challenge when none is given', async () => {
    server = await signupApi({ pendingClaims: 0 })
    const cwd = await mkdtemp(join(tmpdir(), 'cfmc-init-'))
    const opened = []
    let closed = false
    await runInit(
      { email: 'dev@example.com', turnstileSitekey: 'site', apiUrl: `${server.url}/api/v1`, cwd },
      {
        log: () => {},
        challenge: async ({ sitekey }) => ({ url: `http://127.0.0.1/${sitekey}`, token: Promise.resolve('browser-token'), close: () => { closed = true } }),
        open: url => opened.push(url),
      },
    )
    expect(opened).toEqual(['http://127.0.0.1/site'])
    expect(closed).toBe(true)
    expect(server.requests[0].body.turnstile_token).toBe('browser-token')
  })

  it('rejects an invalid email before calling the API', async () => {
    await expect(runInit({ email: 'nope', turnstileToken: 't' }, { log: () => {}, fetch: () => { throw new Error('called') } })).rejects.toThrow(/valid --email/)
  })

  it('adds a hint to API errors', () => {
    expect(describeError(new SignupApiError('Too many.', { code: 'rate_limited', retryAfter: 60 }))).toBe('Too many. Too many signups; try again in 60 seconds.')
  })
})

describe('cli', () => {
  it('runs init end to end and exits 0', async () => {
    server = await signupApi({ pendingClaims: 0 })
    const cwd = await mkdtemp(join(tmpdir(), 'cfmc-cli-'))
    const { stdout } = await run('node', [join(import.meta.dirname, '../bin/cli.js'), 'init', '--email', 'dev@example.com', '--turnstile-token', 'tok', '--api-url', `${server.url}/api/v1`, '--cwd', cwd, '--poll-interval', '1'])
    expect(stdout).toContain('Stored MAILCHANNELS_API_KEY in .dev.vars.')
    expect(await readFile(join(cwd, '.dev.vars'), 'utf8')).toContain('MAILCHANNELS_API_KEY=SECRET-KEY-123')
  })

  it('prints usage and exits 1 without a command', async () => {
    const error = await run('node', [join(import.meta.dirname, '../bin/cli.js')]).catch(e => e)
    expect(error.code).toBe(1)
    expect(error.stdout).toContain('Usage: npx cloudflare-mailchannels init')
  })
})
