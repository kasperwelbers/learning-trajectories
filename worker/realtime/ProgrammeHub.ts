import { DurableObject } from "cloudflare:workers"
import type { HubMessage, Topic } from "@shared/topics"

/**
 * One instance per programme. Holds the WebSocket connections of everyone viewing the
 * programme and tells them which topics changed. It never sends data itself.
 *
 * Uses the WebSocket Hibernation API, so idle connections cost nothing.
 */
export class ProgrammeHub extends DurableObject<Env> {
  override fetch(request: Request): Response {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 })
    }
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    this.sendPresence()
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  /** RPC: called by the worker after a change. */
  broadcast(topics: Topic[]): void {
    if (topics.length === 0) return
    this.send({ type: "invalidate", topics: [...new Set(topics)] })
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    // Clients only send keep-alive pings.
    if (message === "ping") ws.send("pong")
  }

  override webSocketClose(ws: WebSocket, code: number): void {
    try {
      ws.close(code === 1005 ? 1000 : code, "closing")
    } catch {
      // already closed
    }
    this.sendPresence()
  }

  override webSocketError(): void {
    this.sendPresence()
  }

  private sendPresence(): void {
    const open = this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN)
    this.send({ type: "presence", viewers: open.length })
  }

  private send(message: HubMessage): void {
    const payload = JSON.stringify(message)
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload)
      } catch {
        // Socket is closing; it will be cleaned up by webSocketClose.
      }
    }
  }
}
