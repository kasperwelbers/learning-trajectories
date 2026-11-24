import type { Topic } from "@shared/topics"
import type { ProgrammeContext } from "../context"
import { broadcast } from "../realtime/notify"

/** Broadcast invalidations after the response is sent. */
export function notify(c: ProgrammeContext, ...topics: Topic[]): void {
  c.executionCtx.waitUntil(broadcast(c.env, c.get("programmeId"), topics))
}
