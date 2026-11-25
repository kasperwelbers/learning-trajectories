import type { Topic } from "@shared/topics"

/**
 * Query keys. Everything of a programme starts with ["p", programmeId] so a programme's cache
 * can be dropped at once; real-time topics map onto key prefixes.
 */
export const keys = {
  me: ["me"] as const,
  programmes: ["programmes"] as const,
  programme: (pid: string) => ["p", pid, "programme"] as const,
  members: (pid: string) => ["p", pid, "members"] as const,
  shareLinks: (pid: string) => ["p", pid, "shareLinks"] as const,
  structure: (pid: string) => ["p", pid, "structure"] as const,
  frameworks: (pid: string) => ["p", pid, "frameworks"] as const,
  justifications: (pid: string) => ["p", pid, "justifications"] as const,
  fields: (pid: string) => ["p", pid, "fields"] as const,
  courses: (pid: string, year: string) => ["p", pid, "courses", year] as const,
  course: (pid: string, courseId: number, year: string) => ["p", pid, "course", courseId, year] as const,
  coverage: (pid: string, year: string) => ["p", pid, "coverage", year] as const,
  evidence: (pid: string, ltoId: number, year: string) => ["p", pid, "coverage", "evidence", ltoId, year] as const,
  metadata: (pid: string, year: string) => ["p", pid, "coverage", "metadata", year] as const,
}

/** Key prefixes to invalidate when the server announces a topic changed. */
export function topicKeys(pid: string, topic: Topic): readonly (readonly unknown[])[] {
  switch (topic) {
    case "programme":
      return [keys.programme(pid)]
    case "members":
      return [keys.members(pid)]
    case "shareLinks":
      return [keys.shareLinks(pid)]
    case "structure":
      return [keys.structure(pid)]
    case "justifications":
      return [keys.justifications(pid)]
    case "frameworks":
      return [keys.frameworks(pid)]
    case "fields":
      return [keys.fields(pid)]
    case "courses":
      return [["p", pid, "courses"]]
    case "coverage":
      return [["p", pid, "coverage"]]
    default: {
      const courseId = Number(topic.slice("course:".length))
      return [["p", pid, "course", courseId]]
    }
  }
}
