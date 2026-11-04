# Changelog

## 0.1.0 (unreleased)

- Workers module: `fromEnv(env)` / `createMailChannels()` send through `mailchannels-sdk` with the key from the `MAILCHANNELS_API_KEY` secret; a send refused at the free-plan monthly limit returns a `limit_reached` error with the upgrade URL.
- Pages Plugin (`cloudflare-mailchannels/pages`): middleware that puts the sender on `context.data.mailchannels`.
- `npx cloudflare-mailchannels init`: creates a free account through the MailChannels signup API, waits for email verification, and stores the key in `.dev.vars` and/or as a Worker or Pages secret.
- Example Worker and Pages projects, unit tests, and an end-to-end check under `wrangler dev` and `wrangler pages dev`.
