// Pages Plugin: puts a MailChannels sender on context.data.mailchannels for
// every Function below the mount point. Built with
// `wrangler pages functions build --plugin`.
import { fromEnv } from '../../src/index.js'

export async function onRequest(context) {
  const args = context.pluginArgs || {}
  context.data.mailchannels = fromEnv(context.env, {
    apiKey: args.apiKey,
    baseUrl: args.baseUrl,
    upgradeUrl: args.upgradeUrl,
  })
  return context.next()
}
