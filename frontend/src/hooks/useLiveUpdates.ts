import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { parseHubMessage } from "@shared/topics"
import { topicKeys } from "@/api/keys"

const PING_INTERVAL_MS = 30_000
const MAX_BACKOFF_MS = 30_000

export type LiveStatus = "connecting" | "live" | "offline"

/**
 * Keeps the programme's queries fresh: the server announces which topics changed and we
 * invalidate the matching queries. After a reconnect everything is refetched, since updates
 * may have been missed while offline.
 */
export function useLiveUpdates(programmeId: string): {
  status: LiveStatus
  viewers: number
} {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<LiveStatus>("connecting")
  const [viewers, setViewers] = useState(1)

  useEffect(() => {
    let socket: WebSocket | null = null
    let ping: ReturnType<typeof setInterval> | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    let stopped = false

    const connect = () => {
      const protocol = location.protocol === "https:" ? "wss" : "ws"
      socket = new WebSocket(`${protocol}://${location.host}/api/p/${programmeId}/live`)
      socket.onopen = () => {
        if (attempts > 0) void queryClient.invalidateQueries({ queryKey: ["p", programmeId] })
        attempts = 0
        setStatus("live")
        ping = setInterval(() => socket?.send("ping"), PING_INTERVAL_MS)
      }
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return
        const message = parseHubMessage(event.data)
        if (!message) return
        if (message.type === "presence") setViewers(message.viewers)
        else {
          for (const topic of message.topics) {
            for (const queryKey of topicKeys(programmeId, topic)) {
              void queryClient.invalidateQueries({ queryKey })
            }
          }
        }
      }
      socket.onclose = () => {
        clearInterval(ping)
        if (stopped) return
        setStatus("offline")
        attempts++
        retry = setTimeout(connect, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempts))
      }
    }

    connect()
    return () => {
      stopped = true
      clearInterval(ping)
      clearTimeout(retry)
      socket?.close()
    }
  }, [programmeId, queryClient])

  return { status, viewers }
}
