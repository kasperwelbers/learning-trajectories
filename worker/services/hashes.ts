import { eq } from "drizzle-orm"
import { sha256Hex } from "../auth/crypto"
import type { Db } from "../db/client"
import { documents, ltos, trajectories } from "../db/schema"

/**
 * Fingerprint of everything the linking step depends on: LTO wording and narratives, and the
 * trajectory narratives they are read in. When it changes, existing links are stale.
 */
export async function currentLtoHash(db: Db, programmeId: string): Promise<string> {
  const [ltoRows, trajectoryRows] = await Promise.all([
    db
      .select({ id: ltos.id, code: ltos.code, title: ltos.title, narrative: ltos.narrative, trajectoryId: ltos.trajectoryId })
      .from(ltos)
      .where(eq(ltos.programmeId, programmeId)),
    db
      .select({ id: trajectories.id, name: trajectories.name, narrative: trajectories.narrative })
      .from(trajectories)
      .where(eq(trajectories.programmeId, programmeId)),
  ])
  ltoRows.sort((a, b) => a.id - b.id)
  trajectoryRows.sort((a, b) => a.id - b.id)
  return sha256Hex(JSON.stringify([ltoRows, trajectoryRows]))
}

export function documentsHashOf(shas: readonly string[]): Promise<string> {
  return sha256Hex([...shas].sort().join(","))
}

/** Documents hash per `${courseId}|${year}` for a whole programme. */
export async function documentsHashes(db: Db, programmeId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ courseId: documents.courseId, year: documents.year, sha256: documents.sha256 })
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
