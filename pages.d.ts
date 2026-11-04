import type { MailChannelsSender } from './index.js'

export interface PluginArgs {
  /** Overrides the MAILCHANNELS_API_KEY binding. */
  apiKey?: string
  baseUrl?: string
  upgradeUrl?: string
}

/** Data the plugin adds to `context.data`. */
export interface MailChannelsPluginData {
  mailchannels: MailChannelsSender
}

// PagesFunction comes from @cloudflare/workers-types in the consuming project.
export default function mailchannelsPlugin(args?: PluginArgs): PagesFunction
