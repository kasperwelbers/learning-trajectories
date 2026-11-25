/**
 * Real-time invalidation. The server never pushes data over the socket; it only tells clients
 * which topics changed, and clients refetch the matching queries.
 */

export type Topic =
  | "programme"
  | "members"
  | "shareLinks"
  | "structure"
  | "justifications"
  | "frameworks"
  | "fields"
  | "courses"
  | "coverage"
  | `course:${number}`

export type HubMessage =
  { type: "invalidate"; topics: Topic[] } | { type: "presence"; viewers: number }

export function courseTopic(courseId: number): Topic {
  return `course:${courseId}`
}

export function parseHubMessage(raw: string): HubMessage | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== "object" || data === null || !("type" in data)) return null
  if (data.type === "invalidate" && "topics" in data && Array.isArray(data.topics)) {
    const topics = data.topics.filter(isTopic)
    return { type: "invalidate", topics }
  }
  if (data.type === "presence" && "viewers" in data && typeof data.viewers === "number") {
    return { type: "presence", viewers: data.viewers }
  }
  return null
}

const SIMPLE_TOPICS: ReadonlySet<string> = new Set([
  "programme",
  "members",
  "shareLinks",
  "structure",
  "justifications",
  "frameworks",
  "fields",
  "courses",
  "coverage",
])

function isTopic(value: unknown): value is Topic {
  if (typeof value !== "string") return false
  return SIMPLE_TOPICS.has(value) || /^course:\d+$/.test(value)
}
