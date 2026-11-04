#!/usr/bin/env node
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { describeError, runInit, UsageError } from '../src/init.js'

const HELP = `Usage: npx cloudflare-mailchannels init [options]

Creates a free MailChannels Email API account, waits for you to verify your
email address, and stores the API key as MAILCHANNELS_API_KEY.

Options:
  --email <address>          Email address that owns the account (prompted if omitted)
  --domain <domain>          Domain you will send from (default: the email's domain)
  --no-dev-vars              Do not write the key to .dev.vars
  --secret                   Also store the key as a Worker secret (wrangler secret put)
  --pages-project <name>     Store it as a secret on this Pages project instead
  --env <name>               Wrangler environment for the secret
  --cwd <dir>                Project directory (default: current directory)
  --turnstile-token <token>  Use this Turnstile token instead of opening the browser check
  --turnstile-sitekey <key>  Turnstile sitekey for the browser check
  --no-open                  Print the browser check URL without opening it
  --api-url <url>            Signup API base URL (default: https://dash.mailchannels.com/api/v1)
  --poll-interval <seconds>  Seconds between verification checks (default: 5)
  --timeout <minutes>        Minutes to wait for verification (default: 30)
  -h, --help                 Show this help
`

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    allowNegative: true,
    options: {
      'email': { type: 'string' },
      'domain': { type: 'string' },
      'dev-vars': { type: 'boolean', default: true },
      'secret': { type: 'boolean', default: false },
      'pages-project': { type: 'string' },
      'env': { type: 'string' },
      'cwd': { type: 'string' },
      'turnstile-token': { type: 'string' },
      'turnstile-sitekey': { type: 'string' },
      'open': { type: 'boolean', default: true },
      'api-url': { type: 'string' },
      'poll-interval': { type: 'string' },
      'timeout': { type: 'string' },
      'help': { type: 'boolean', short: 'h' },
    },
  })
  if (values.help || positionals[0] !== 'init') {
    process.stdout.write(HELP)
    return values.help ? 0 : 1
  }
  const env = process.env
  const rl = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null
  try {
    await runInit({
      email: values.email,
      domain: values.domain,
      devVars: values['dev-vars'],
      secret: values.secret,
      pagesProject: values['pages-project'],
      env: values.env,
      cwd: values.cwd,
      turnstileToken: values['turnstile-token'] || env.MAILCHANNELS_TURNSTILE_TOKEN,
      turnstileSitekey: values['turnstile-sitekey'] || env.MAILCHANNELS_TURNSTILE_SITEKEY,
      open: values.open,
      apiUrl: values['api-url'] || env.MAILCHANNELS_SIGNUP_API_URL,
      pollInterval: number(values['poll-interval'], '--poll-interval'),
      timeout: number(values.timeout, '--timeout'),
    }, { prompt: rl ? q => rl.question(q) : undefined })
    return 0
  }
  finally {
    rl?.close()
  }
}

function number(value, flag) {
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) throw new UsageError(`${flag} must be a positive number.`)
  return n
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code },
  (error) => {
    process.stderr.write(`Error: ${error instanceof UsageError ? error.message : describeError(error)}\n`)
    process.exitCode = error instanceof UsageError ? 2 : 1
  },
)
