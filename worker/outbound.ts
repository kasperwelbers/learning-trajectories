/**
 * Outbound HTTP for AI calls and page fetches.
 *
 * In sandboxed development environments the local Workers runtime may not be able to reach the
 * internet directly. Setting OUTBOUND_RELAY (e.g. http://127.0.0.1:8790) sends requests through
 * `scripts/dev-relay.ts`, a small Node server that does have network access. Leave it unset in
 * production and in normal local development.
 */
export function outboundFetch(env: { OUTBOUND_RELAY?: string }): typeof fetch {
  const relay = env.OUTBOUND_RELAY
  if (!relay) return fetch
  return async (input, init) => {
    const request = new Request(input, init)
    const headers = new Headers(request.headers)
    headers.set("x-relay-url", request.url)
    return fetch(relay, {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD" ? null : await request.arrayBuffer(),
    })
  }
}
