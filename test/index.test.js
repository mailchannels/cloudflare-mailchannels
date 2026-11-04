import { createSimulator } from 'mailchannels-sdk/simulator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createMailChannels, DEFAULT_UPGRADE_URL, fromEnv, isLimitError } from '../src/index.js'
import { stubServer } from './helpers/stub-server.js'

const message = { from: 'app@example.com', to: 'user@example.net', subject: 'Hi', html: '<p>Hi</p>' }

describe('send against the SDK simulator', () => {
  let simulator, baseUrl
  beforeAll(async () => {
    simulator = createSimulator({ silent: true })
    baseUrl = await simulator.listen({ port: 0 })
  })
  afterAll(() => simulator.close())

  it('sends with the key from the Worker secret', async () => {
    const sender = fromEnv({ MAILCHANNELS_API_KEY: 'test-key', MAILCHANNELS_BASE_URL: baseUrl })
    const { data, error } = await sender.send(message)
    expect(error).toBeNull()
    expect(data).toBeTruthy()
  })
})

describe('limit handling', () => {
  let server
  afterEach(() => server?.close())

  it('turns a refusal at the monthly limit into limit_reached with the upgrade URL', async () => {
    server = await stubServer({
      'POST /tx/v1/send': () => ({ status: 403, json: { errors: ['Forbidden'] } }),
      'GET /tx/v1/usage': () => ({ status: 200, json: { total_usage: 3000, monthly_limit: 3000, start_date: '2026-10-01', end_date: '2026-10-31' } }),
    })
    const sender = createMailChannels({ apiKey: 'k', baseUrl: server.url, upgradeUrl: 'https://upgrade.example/billing' })
    const { data, error } = await sender.send(message)
    expect(data).toBeNull()
    expect(isLimitError(error)).toBe(true)
    expect(error.upgradeUrl).toBe('https://upgrade.example/billing')
    expect(error.message).toContain('https://upgrade.example/billing')
    expect(error.message).toContain('3000 of 3000')
    expect(error.usage).toEqual({ total: 3000, monthlyLimit: 3000 })
    expect(error.statusCode).toBe(403)
  })

  it('returns the original error when the account is under its limit', async () => {
    server = await stubServer({
      'POST /tx/v1/send': () => ({ status: 403, json: { errors: ['Domain Lockdown'] } }),
      'GET /tx/v1/usage': () => ({ status: 200, json: { total_usage: 12, monthly_limit: 3000 } }),
    })
    const { error } = await createMailChannels({ apiKey: 'k', baseUrl: server.url }).send(message)
    expect(isLimitError(error)).toBe(false)
    expect(error.statusCode).toBe(403)
  })

  it('does not look up usage for request errors', async () => {
    server = await stubServer({
      'POST /tx/v1/send': () => ({ status: 400, json: { errors: ['bad'] } }),
    })
    const { error } = await createMailChannels({ apiKey: 'k', baseUrl: server.url }).send(message)
    expect(error.statusCode).toBe(400)
    expect(server.requests.map(r => r.path)).toEqual(['/tx/v1/send'])
  })

  it('falls back to the refusal text when usage is unavailable', async () => {
    server = await stubServer({
      'POST /tx/v1/send': () => ({ status: 429, json: { message: 'Sending quota exceeded.' } }),
      'GET /tx/v1/usage': () => ({ status: 500, json: {} }),
    })
    const { error } = await createMailChannels({ apiKey: 'k', baseUrl: server.url }).send(message)
    expect(isLimitError(error)).toBe(true)
    expect(error.usage).toBeNull()
    expect(error.upgradeUrl).toBe(DEFAULT_UPGRADE_URL)
  })
})

describe('configuration', () => {
  it('reports a missing key from send instead of throwing', async () => {
    const sender = fromEnv({})
    const { data, error } = await sender.send(message)
    expect(data).toBeNull()
    expect(error.type).toBe('missing_api_key')
    expect(error.message).toContain('npx cloudflare-mailchannels init')
  })

  it('lets explicit options override bindings and keeps the default upgrade URL', () => {
    const sender = fromEnv({ MAILCHANNELS_API_KEY: 'from-env', MAILCHANNELS_UPGRADE_URL: '' }, { apiKey: 'explicit' })
    expect(sender.client).not.toBeNull()
    expect(sender.upgradeUrl).toBe(DEFAULT_UPGRADE_URL)
  })
})
