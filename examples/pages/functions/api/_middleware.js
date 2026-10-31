// Mount the plugin for every Function under /api.
import mailchannelsPlugin from 'cloudflare-mailchannels/pages'

export const onRequest = mailchannelsPlugin()
