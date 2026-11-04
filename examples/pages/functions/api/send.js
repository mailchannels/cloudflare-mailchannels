export async function onRequestPost({ request, env, data }) {
  const { to, subject, text } = await request.json()
  const { data: result, error } = await data.mailchannels.send({ from: env.MAIL_FROM, to, subject, text })
  if (error) {
    // A free account at its monthly limit gets error.type "limit_reached" and an upgradeUrl.
    const status = error.type === 'limit_reached' ? 429 : 502
    return Response.json({ error: error.type, message: error.message, upgrade_url: error.upgradeUrl }, { status })
  }
  return Response.json({ sent: true, data: result })
}
