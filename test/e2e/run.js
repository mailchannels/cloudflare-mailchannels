// End-to-end check of the examples under real `wrangler dev` / `wrangler pages dev`.
// Synthetic only: the SDK simulator stands in for the Email API (behind a
// recording proxy), and local stubs stand in for the signup API and for an
// account at its free-plan limit. Run with `npm run test:e2e`.
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { appendFile, readFile, rm } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createSimulator } from 'mailchannels-sdk/simulator'
import { stubServer } from '../helpers/stub-server.js'

const root = join(import.meta.dirname, '../..')
const pagesDir = join(root, 'examples/pages')
const workerDir = join(root, 'examples/worker')
const UPGRADE_URL = 'https://dash.mailchannels.com/billing'
const log = (...args) => console.log(`[e2e ${new Date().toISOString()}]`, ...args)

const simulator = createSimulator({ silent: true })
const simulatorUrl = await simulator.listen({ port: 18787 })
const sends = []
const emailApi = await recordingProxy(simulatorUrl, sends)
const signupApi = await stubServer({
  'POST /api/v1/signup': () => ({ status: 202, json: { status: 'verification_pending', message: 'm', claim_token: 'e2e-claim', claim_url: '/api/v1/signup/claim', free_plan_monthly_limit: 3000, upgrade_url: UPGRADE_URL } }),
  'POST /api/v1/signup/claim': () => ({ status: 200, json: { status: 'ready', message: 'm', api_key: 'e2e-synthetic-key', account_id: 'e2eacct', free_plan_monthly_limit: 3000, upgrade_url: UPGRADE_URL } }),
})
const atLimitApi = await stubServer({
  'POST /tx/v1/send': () => ({ status: 403, json: { errors: ['Forbidden'] } }),
  'GET /tx/v1/usage': () => ({ status: 200, json: { total_usage: 3000, monthly_limit: 3000 } }),
})
const message = { to: 'recipient@example.net', subject: 'e2e', text: 'Hello from the e2e check' }
let failed = false

try {
  log('1. init in examples/pages against the stub signup API')
  await rm(join(pagesDir, '.dev.vars'), { force: true })
  const { stdout } = await promisify(execFile)('node', [join(root, 'bin/cli.js'), 'init', '--email', 'dev@example.com', '--turnstile-token', 'XXXX.DUMMY.TOKEN.XXXX', '--api-url', `${signupApi.url}/api/v1`, '--cwd', pagesDir, '--poll-interval', '1'])
  console.log(stdout.replace(/^/gm, '    '))
  const devVars = await readFile(join(pagesDir, '.dev.vars'), 'utf8')
  assert.match(devVars, /^MAILCHANNELS_API_KEY=e2e-synthetic-key$/m)
  assert.equal(stdout.includes('e2e-synthetic-key'), false, 'init must not print the key')
  log('   .dev.vars has MAILCHANNELS_API_KEY; the key was not printed')

  log('2. wrangler pages dev, POST /api/send -> Email API (simulator)')
  await appendFile(join(pagesDir, '.dev.vars'), `MAILCHANNELS_BASE_URL=${emailApi.url}\n`)
  await withServer(['wrangler', 'pages', 'dev', 'public', '--port', '18790', '--ip', '127.0.0.1'], pagesDir, async (base) => {
    const res = await post(`${base}/api/send`, message)
    log(`   HTTP ${res.status}`, JSON.stringify(res.body))
    assert.equal(res.status, 200)
    assert.equal(sends.length, 1)
    assert.equal(sends[0].headers['x-api-key'], 'e2e-synthetic-key')
    assert.equal(sends[0].body.from.email, 'app@example.com')
    log('   exactly one send reached the Email API, with the key from .dev.vars')
  })

  log('3. wrangler pages dev with an account at its free-plan limit')
  await withServer(['wrangler', 'pages', 'dev', 'public', '--port', '18790', '--ip', '127.0.0.1', '--binding', `MAILCHANNELS_BASE_URL=${atLimitApi.url}`], pagesDir, async (base) => {
    const res = await post(`${base}/api/send`, message)
    log(`   HTTP ${res.status}`, JSON.stringify(res.body))
    assert.equal(res.status, 429)
    assert.equal(res.body.error, 'limit_reached')
    assert.equal(res.body.upgrade_url, UPGRADE_URL)
    assert.ok(res.body.message.includes(UPGRADE_URL))
  })

  log('4. wrangler dev (Workers module), POST /send -> Email API (simulator)')
  await withServer(['wrangler', 'dev', '--port', '18791', '--ip', '127.0.0.1', '--var', 'MAILCHANNELS_API_KEY:e2e-synthetic-key', '--var', `MAILCHANNELS_BASE_URL:${emailApi.url}`], workerDir, async (base) => {
    const before = sends.length
    const res = await post(`${base}/send`, message)
    log(`   HTTP ${res.status}`, JSON.stringify(res.body))
    assert.equal(res.status, 200)
    assert.equal(sends.length - before, 1)
    log('   exactly one send reached the Email API')
  })
  log('PASS')
}
catch (error) {
  failed = true
  log('FAIL', error)
}
finally {
  await rm(join(pagesDir, '.dev.vars'), { force: true })
  await Promise.all([signupApi.close(), atLimitApi.close(), emailApi.close(), simulator.close()])
  process.exit(failed ? 1 : 0)
}

async function withServer(args, cwd, fn) {
  const child = spawn('npx', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  let output = ''
  child.stdout.on('data', d => { output += d })
  child.stderr.on('data', d => { output += d })
  const port = args[args.indexOf('--port') + 1]
  const base = `http://127.0.0.1:${port}`
  try {
    const deadline = Date.now() + 90_000
    for (;;) {
      if (/Ready on/.test(output)) break
      if (child.exitCode !== null || Date.now() > deadline) throw new Error(`wrangler did not start:\n${output}`)
      await new Promise(r => setTimeout(r, 500))
    }
    await fn(base)
  }
  finally {
    process.kill(-child.pid, 'SIGTERM')
    await new Promise(r => child.once('close', r))
  }
}

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, body: await res.json() }
}

async function recordingProxy(target, records) {
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    if (req.method === 'POST' && req.url.startsWith('/tx/v1/send')) records.push({ headers: req.headers, body: JSON.parse(raw) })
    const upstream = httpRequest(new URL(req.url, target), { method: req.method, headers: req.headers }, (up) => {
      res.writeHead(up.statusCode, up.headers)
      up.pipe(res)
    })
    upstream.end(raw)
  })
  await new Promise(resolve => server.listen(18789, '127.0.0.1', resolve))
  return { url: 'http://127.0.0.1:18789', close: () => new Promise(r => server.close(r)) }
}
