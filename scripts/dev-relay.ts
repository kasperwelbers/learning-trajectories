/**
 * Development-only HTTP relay for sandboxed environments (see worker/outbound.ts).
 *
 *   NODE_USE_ENV_PROXY=1 pnpm dev:relay
 *
 * Then set OUTBOUND_RELAY=http://127.0.0.1:8790 in .dev.vars. Only listens on localhost.
 */
import { createServer } from "node:http"

const PORT = Number(process.env.RELAY_PORT ?? 8790)
const DROP_HEADERS = new Set(["host", "connection", "content-length", "x-relay-url", "accept-encoding"])

createServer((req, res) => {
  const target = req.headers["x-relay-url"]
  if (typeof target !== "string" || !/^https?:\/\//.test(target)) {
    res.writeHead(400).end("Missing x-relay-url")
    return
  }
  const chunks: Buffer[] = []
  req.on("data", (chunk: Buffer) => chunks.push(chunk))
  req.on("end", () => {
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (!DROP_HEADERS.has(key) && typeof value === "string") headers.set(key, value)
    }
    const method = req.method ?? "GET"
    fetch(target, { method, headers, body: method === "GET" || method === "HEAD" ? null : Buffer.concat(chunks) })
      .then(async (response) => {
        const body = Buffer.from(await response.arrayBuffer())
        const type = response.headers.get("content-type")
        res.writeHead(response.status, type ? { "content-type": type } : {})
        res.end(body)
      })
      .catch((error: unknown) => {
        res.writeHead(502).end(error instanceof Error ? error.message : "Relay failed")
      })
  })
}).listen(PORT, "127.0.0.1", () => {
  console.log(`dev relay listening on http://127.0.0.1:${PORT}`)
})
