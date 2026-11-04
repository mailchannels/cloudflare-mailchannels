# cloudflare-mailchannels

Send email from Cloudflare Workers and Pages Functions with the
[MailChannels Email API](https://docs.mailchannels.com/email-api).

- **Workers module** — `fromEnv(env).send(...)`, built on the official
  [`mailchannels-sdk`](https://www.npmjs.com/package/mailchannels-sdk), with the
  API key read from a Worker secret.
- **Pages Plugin** — `cloudflare-mailchannels/pages` puts the same sender on
  `context.data.mailchannels` for your Pages Functions.
- **`npx cloudflare-mailchannels init`** — creates a free MailChannels account
  from your terminal, waits for you to verify your email address, and stores the
  API key in `.dev.vars` or as a Worker secret.

Accounts created by `init` are regular Email API accounts on the free plan
(3,000 emails per month). When an account reaches its limit, sends return a
`limit_reached` error with the URL where you can upgrade.

> Cloudflare recommends Workers for new projects, and Pages Plugins are not
> available on Workers. The Workers module is the primary interface; the Pages
> Plugin is a thin wrapper around it for existing Pages projects.

## Install

```sh
npm install cloudflare-mailchannels
```

## Create an account and store the key

In your Worker or Pages project directory:

```sh
npx cloudflare-mailchannels init --email you@example.com
```

`init` opens a short browser check (Cloudflare Turnstile), requests the
account, and asks you to click the verification link MailChannels emails you.
Once you do, it stores the key as `MAILCHANNELS_API_KEY` in `.dev.vars` (and adds
`.dev.vars` to `.gitignore`). It never prints the key.

To store the key for deployed code too:

```sh
# Workers: wrangler secret put MAILCHANNELS_API_KEY
npx cloudflare-mailchannels init --email you@example.com --secret

# Pages: wrangler pages secret put MAILCHANNELS_API_KEY --project-name my-site
npx cloudflare-mailchannels init --email you@example.com --pages-project my-site
```

If you already have a MailChannels account, no verification email arrives.
Create an API key in the [web app](https://dash.mailchannels.com/account/api-keys)
and store it with `wrangler secret put MAILCHANNELS_API_KEY` instead.

Run `npx cloudflare-mailchannels --help` for every option, including
`--turnstile-token` for non-interactive use.

## Allow your domain (Domain Lockdown)

Before the first send, add the TXT record `init` prints for each domain you
send from. MailChannels refuses mail from domains without it:

```text
_mailchannels.example.com  TXT  "v=mc1 auth=YOUR_ACCOUNT_ID"
```

See [Domain Lockdown](https://docs.mailchannels.com/email-api/domain-lockdown).

## Send from a Worker

```js
import { fromEnv } from 'cloudflare-mailchannels'

export default {
  async fetch(request, env) {
    const { data, error } = await fromEnv(env).send({
      from: 'app@example.com',
      to: 'user@example.net',
      subject: 'Hello',
      text: 'Sent from a Cloudflare Worker',
    })
    if (error) return Response.json(error, { status: 502 })
    return Response.json(data)
  },
}
```

`send` takes the SDK's [send options](https://mailchannels.yizack.com) and
returns `{ data, error }` like the SDK.

## Send from Pages Functions

Mount the plugin with a middleware, for example `functions/api/_middleware.js`:

```js
import mailchannelsPlugin from 'cloudflare-mailchannels/pages'

export const onRequest = mailchannelsPlugin()
```

Then use the sender in any Function below it, for example `functions/api/send.js`:

```js
export async function onRequestPost({ data }) {
  const { error } = await data.mailchannels.send({
    from: 'app@example.com',
    to: 'user@example.net',
    subject: 'Hello',
    text: 'Sent from Pages Functions',
  })
  return Response.json({ sent: !error, error })
}
```

`mailchannelsPlugin({ apiKey, baseUrl, upgradeUrl })` accepts the same options
as the Workers module; by default it reads the bindings below.

## Bindings

| Binding                    | Kind   | Purpose                                                     |
|----------------------------|--------|-------------------------------------------------------------|
| `MAILCHANNELS_API_KEY`     | secret | Email API key. Required.                                    |
| `MAILCHANNELS_UPGRADE_URL` | var    | Upgrade link in limit errors. Default `https://dash.mailchannels.com/billing`. |
| `MAILCHANNELS_BASE_URL`    | var    | Email API base URL, for example the SDK's local simulator.  |

Without `MAILCHANNELS_API_KEY`, `send` returns an error of type
`missing_api_key` instead of throwing, so the rest of your site keeps working.

## Free plan limit and upgrading

When MailChannels refuses a send, the plugin checks the account's usage. If the
account has used its monthly allowance, the error is:

```js
{
  type: 'limit_reached',
  message: 'MailChannels refused the send because this account has reached its monthly sending limit (3000 of 3000 emails used this period). Upgrade to a paid plan at https://dash.mailchannels.com/billing',
  upgradeUrl: 'https://dash.mailchannels.com/billing',
  usage: { total: 3000, monthlyLimit: 3000 },
  statusCode: 403,
}
```

Use `isLimitError(error)` to detect it. Upgrading needs a payment card and is
done by an account administrator at the upgrade URL.

## Local development without sending

Point the sender at the SDK's in-memory simulator:

```sh
npx mailchannels-sdk simulate --port 8788
echo 'MAILCHANNELS_BASE_URL=http://127.0.0.1:8788' >> .dev.vars
```

## Examples

- [`examples/worker`](examples/worker): a Worker with `POST /send` (`npm run dev`).
- [`examples/pages`](examples/pages): a Pages site with a form and `POST /api/send` (`npm run dev`).

## Development

```sh
npm install
npm run build       # builds the Pages Plugin into dist/pages
npm test            # unit tests (vitest)
npm ci --prefix examples/pages && npm ci --prefix examples/worker
npm run test:e2e    # runs both examples under wrangler against local stubs
```

The end-to-end check uses only synthetic data: the SDK simulator stands in for
the Email API, and local stubs stand in for the signup API and for an account
at its limit.

## License

MIT
