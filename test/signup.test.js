import { afterEach, describe, expect, it } from 'vitest'
import { ClaimTimeoutError, claimOnce, requestSignup, SignupApiError, waitForClaim } from '../src/signup.js'
import { stubServer } from './helpers/stub-server.js'

const pending = { status: 'verification_pending', message: 'm', claim_token: 'ct', claim_url: '/api/v1/signup/claim', free_plan_monthly_limit: 3000, upgrade_url: 'https://dash.mailchannels.com/billing' }

let server
afterEach(() => server?.close())

describe('requestSignup', () => {
  it('posts email, domain, token and the cloudflare-plugin source', async () => {
    server = await stubServer({ 'POST /api/v1/signup': () => ({ status: 202, json: pending }) })
    const result = await requestSignup({ apiUrl: `${server.url}/api/v1/`, email: 'dev@example.com', domain: 'example.com', turnstileToken: 'tok' })
    expect(result.claim_token).toBe('ct')
    expect(server.requests[0].body).toEqual({ email: 'dev@example.com', domain: 'example.com', turnstile_token: 'tok', source: 'cloudflare-plugin' })
  })

  it('raises the API error code, message and Retry-After', async () => {
    server = await stubServer({
      'POST /api/v1/signup': () => ({ status: 429, headers: { 'Retry-After': '60' }, json: { status: 'error', error: 'rate_limited', message: 'Too many signups.' } }),
    })
    const error = await requestSignup({ apiUrl: `${server.url}/api/v1`, email: 'a@b.co', turnstileToken: 't' }).catch(e => e)
    expect(error).toBeInstanceOf(SignupApiError)
    expect(error).toMatchObject({ status: 429, code: 'rate_limited', retryAfter: 60, message: 'Too many signups.' })
  })

  it('explains a 404 as the API not being enabled', async () => {
    server = await stubServer({})
    const error = await requestSignup({ apiUrl: server.url, email: 'a@b.co', turnstileToken: 't' }).catch(e => e)
    expect(error.status).toBe(404)
    expect(error.message).toMatch(/not be enabled/)
  })
})

describe('claim', () => {
  it('distinguishes pending from ready', async () => {
    let calls = 0
    server = await stubServer({
      'POST /signup/claim': () => (++calls < 2
        ? { status: 202, json: { status: 'verification_pending' } }
        : { status: 200, json: { status: 'ready', api_key: 'key', account_id: 'acct' } }),
    })
    expect((await claimOnce({ apiUrl: server.url, claimToken: 'ct' })).ready).toBe(false)
    expect(await claimOnce({ apiUrl: server.url, claimToken: 'ct' })).toMatchObject({ ready: true, api_key: 'key' })
    expect(server.requests[0].body).toEqual({ claim_token: 'ct' })
  })

  it('polls until ready, waiting longer when rate limited', async () => {
    const replies = [
      { status: 202, json: { status: 'verification_pending' } },
      { status: 429, headers: { 'Retry-After': '30' }, json: { status: 'error', error: 'rate_limited', message: 'slow down' } },
      { status: 200, json: { status: 'ready', api_key: 'key', account_id: 'acct' } },
    ]
    server = await stubServer({ 'POST /signup/claim': () => replies.shift() })
    const sleeps = []
    const result = await waitForClaim({ apiUrl: server.url, claimToken: 'ct', intervalMs: 5000, sleep: async ms => sleeps.push(ms) })
    expect(result.api_key).toBe('key')
    expect(sleeps).toEqual([5000, 30000])
  })

  it('times out while the address stays unverified', async () => {
    server = await stubServer({ 'POST /signup/claim': () => ({ status: 202, json: { status: 'verification_pending' } }) })
    let clock = 0
    const error = await waitForClaim({
      apiUrl: server.url,
      claimToken: 'ct',
      intervalMs: 1000,
      timeoutMs: 2500,
      now: () => clock,
      sleep: async (ms) => { clock += ms },
    }).catch(e => e)
    expect(error).toBeInstanceOf(ClaimTimeoutError)
    expect(server.requests).toHaveLength(3)
  })

  it('stops on errors other than rate limits', async () => {
    server = await stubServer({ 'POST /signup/claim': () => ({ status: 503, json: { status: 'error', error: 'unavailable', message: 'down' } }) })
    const error = await waitForClaim({ apiUrl: server.url, claimToken: 'ct', sleep: async () => {} }).catch(e => e)
    expect(error).toMatchObject({ status: 503, code: 'unavailable' })
  })
})
