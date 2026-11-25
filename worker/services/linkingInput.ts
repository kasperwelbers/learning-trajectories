import { asc, eq } from "drizzle-orm"
import type { Db } from "../db/client"
import { ltos, trajectories } from "../db/schema"
import type { LinkingLto } from "../pipeline/link"

/** All LTOs of a programme with their trajectory, as input for the linking prompt. */
export async function ltosForLinking(db: Db, programmeId: string): Promise<LinkingLto[]> {
  const rows = await db
    .select({
      id: ltos.id,
      code: ltos.code,
      title: ltos.title,
      narrative: ltos.narrative,
      trajectoryName: trajectories.name,
      trajectoryNarrative: trajectories.narrative,
    })
    .from(ltos)
    .innerJoin(trajectories, eq(trajectories.id, ltos.trajectoryId))
    .where(eq(ltos.programmeId, programmeId))
    .orderBy(asc(trajectories.position), asc(ltos.position))
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    title: r.title,
    narrative: r.narrative,
    trajectory: { name: r.trajectoryName, narrative: r.trajectoryNarrative },
  }))
}
