import { fromEnv } from 'cloudflare-mailchannels'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.method !== 'POST' || url.pathname !== '/send') {
      return new Response('POST /send with {"to", "subject", "text"}', { status: 404 })
    }
    const { to, subject, text } = await request.json()
    const { data, error } = await fromEnv(env).send({ from: env.MAIL_FROM, to, subject, text })
    if (error) {
      // A free account at its monthly limit gets error.type "limit_reached" and an upgradeUrl.
      const status = error.type === 'limit_reached' ? 429 : 502
      return Response.json({ error: error.type, message: error.message, upgrade_url: error.upgradeUrl }, { status })
    }
    return Response.json({ sent: true, data })
  },
}
