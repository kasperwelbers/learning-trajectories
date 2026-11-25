import { eq } from "drizzle-orm"
import { sha256Hex } from "../auth/crypto"
import type { Db } from "../db/client"
import { documents } from "../db/schema"
import type { LinkingLto } from "../pipeline/link"
import { ltosForLinking } from "./linkingInput"

/** Fingerprint of everything the linking prompt reads about one LTO. */
export function ltoHash(lto: LinkingLto): Promise<string> {
  return sha256Hex(
    JSON.stringify([
      lto.code,
      lto.title,
      lto.narrative,
      lto.trajectory.name,
      lto.trajectory.narrative,
    ]),
  )
}

/** Current fingerprint per LTO id. */
export async function ltoHashes(db: Db, programmeId: string): Promise<Map<number, string>> {
  const ltos = await ltosForLinking(db, programmeId)
  const entries = await Promise.all(ltos.map(async (lto) => [lto.id, await ltoHash(lto)] as const))
  return new Map(entries)
}

export function documentsHashOf(shas: readonly string[]): Promise<string> {
  return sha256Hex([...shas].sort().join(","))
}

/** Documents hash per `${courseId}|${year}` for a whole programme. */
export async function documentsHashes(db: Db, programmeId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({
      courseId: documents.courseId,
      year: documents.year,
      sha256: documents.sha256,
    })
    .from(documents)
    .where(eq(documents.programmeId, programmeId))
  const grouped = new Map<string, string[]>()
  for (const row of rows) {
    const key = `${row.courseId}|${row.year}`
    grouped.set(key, [...(grouped.get(key) ?? []), row.sha256])
  }
  const result = new Map<string, string>()
  for (const [key, shas] of grouped) result.set(key, await documentsHashOf(shas))
  return result
}
