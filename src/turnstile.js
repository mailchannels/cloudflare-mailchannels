// Gets a Cloudflare Turnstile token from the person running init: serves a
// one-page challenge on 127.0.0.1, opens it in their browser, and waits for the
// widget to hand the token back to the loopback server.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

// The production sitekey of MailChannels' signup widget. It is set when the
// widget is created for the release (its hostnames must include 127.0.0.1);
// until then pass --turnstile-sitekey or set MAILCHANNELS_TURNSTILE_SITEKEY.
export const DEFAULT_TURNSTILE_SITEKEY = ''

/**
 * Starts the loopback challenge server. Resolves to `{ url, token, close }`,
 * where `token` is a promise for the Turnstile token.
 */
export async function startChallengeServer({ sitekey, timeoutMs = 10 * 60 * 1000 }) {
  if (!sitekey) throw new Error('No Turnstile sitekey: pass --turnstile-sitekey, set MAILCHANNELS_TURNSTILE_SITEKEY, or pass --turnstile-token.')
  const state = randomBytes(16).toString('hex')
  let settle
  const token = new Promise((resolve, reject) => {
    settle = { resolve, reject }
  })

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      })
      res.end(challengePage(sitekey, state))
      return
    }
    if (req.method === 'GET' && url.pathname === '/callback') {
      const value = url.searchParams.get('token')
      if (url.searchParams.get('state') !== state || !value) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('This link is not valid for the running init command.')
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end('<!doctype html><meta charset="utf-8"><title>MailChannels</title><p>Done. You can close this tab and return to your terminal.</p>')
      settle.resolve(value)
      return
    }
    res.writeHead(404)
    res.end()
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const timer = setTimeout(() => settle.reject(new Error('Timed out waiting for the browser challenge.')), timeoutMs)
  const close = () => {
    clearTimeout(timer)
    server.close()
  }
  token.then(close, close)
  const { port } = server.address()
  return { url: `http://127.0.0.1:${port}/`, token, close }
}

/** Best-effort attempt to open `url` in the default browser. */
export function openBrowser(url, { platform = process.platform, spawnFn = spawn } = {}) {
  const [command, args] = platform === 'darwin'
    ? ['open', [url]]
    : platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url]]
      : ['xdg-open', [url]]
  try {
    const child = spawnFn(command, args, { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref?.()
  }
  catch {
    // The URL is also printed, so a missing opener is not fatal.
  }
}

function challengePage(sitekey, state) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MailChannels signup</title>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5}</style>
</head>
<body>
<h1>Create your MailChannels account</h1>
<p>Complete the check below to continue signing up from your terminal.</p>
<div class="cf-turnstile" data-sitekey="${escapeHtml(sitekey)}" data-callback="mailchannelsDone"></div>
<script>
function mailchannelsDone(token) {
  location.href = '/callback?state=${state}&token=' + encodeURIComponent(token)
}
</script>
</body>
</html>`
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c])
}
