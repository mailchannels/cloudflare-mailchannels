import { createServer } from 'node:http'

/**
 * A local HTTP server whose routes are `"METHOD /path": (body, req) => ({ status, json, headers })`.
 * Records every request in `requests`.
 */
export async function stubServer(routes) {
  const requests = []
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = raw ? JSON.parse(raw) : null
    const path = new URL(req.url, 'http://x').pathname
    requests.push({ method: req.method, path, body, headers: req.headers })
    const handler = routes[`${req.method} ${path}`]
    const { status = 404, json = {}, headers = {} } = handler ? await handler(body, req) : {}
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
    res.end(JSON.stringify(json))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}
