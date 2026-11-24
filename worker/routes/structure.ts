import { and, asc, eq, max, sql } from "drizzle-orm"
import { Hono } from "hono"
import {
  createLtoBody,
  createTrajectoryBody,
  importLtosBody,
  updateLtoBody,
  updateTrajectoryBody,
  type ImportLtosResponse,
  type LtoDto,
  type StructureResponse,
  type TrajectoryDto,
} from "@shared/api"
import { requireAdmin, requireTrajectoryEditor } from "../access"
import type { ProgrammeEnv } from "../context"
import type { Db } from "../db/client"
import { assertVersionedUpdate, isUniqueViolation } from "../db/helpers"
import { ltos, trajectories } from "../db/schema"
import { HttpError, found } from "../errors"
import { intParam, validate } from "../validation"
import { notify } from "./notify"

export const structureRoutes = new Hono<ProgrammeEnv>()

type LtoRow = typeof ltos.$inferSelect
type TrajectoryRow = typeof trajectories.$inferSelect

export function toLtoDto(row: LtoRow): LtoDto {
  return {
    id: row.id,
    trajectoryId: row.trajectoryId,
    code: row.code,
    title: row.title,
    narrative: row.narrative,
    position: row.position,
    version: row.version,
  }
}

function toTrajectoryDto(row: TrajectoryRow, ltoRows: LtoRow[]): TrajectoryDto {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    narrative: row.narrative,
    position: row.position,
    version: row.version,
    ltos: ltoRows.filter((l) => l.trajectoryId === row.id).map(toLtoDto),
  }
}

export async function loadStructure(db: Db, programmeId: string): Promise<StructureResponse> {
  const [trajectoryRows, ltoRows] = await Promise.all([
    db
      .select()
      .from(trajectories)
      .where(eq(trajectories.programmeId, programmeId))
      .orderBy(asc(trajectories.position), asc(trajectories.id)),
    db
      .select()
      .from(ltos)
      .where(eq(ltos.programmeId, programmeId))
      .orderBy(asc(ltos.position), asc(ltos.id)),
  ])
  return { trajectories: trajectoryRows.map((t) => toTrajectoryDto(t, ltoRows)) }
}

structureRoutes.get("/structure", async (c) => {
  return c.json(await loadStructure(c.get("db"), c.get("programmeId")))
})

// ── Trajectories ────────────────────────────────────────────────────────────

async function getTrajectory(db: Db, programmeId: string, id: number): Promise<TrajectoryRow> {
  return found(
    await db
      .select()
      .from(trajectories)
      .where(and(eq(trajectories.id, id), eq(trajectories.programmeId, programmeId)))
      .get(),
    "Trajectory not found",
  )
}

const duplicateName = () => new HttpError(409, "A trajectory with this name already exists", "conflict")
const duplicateCode = () => new HttpError(409, "An LTO with this code already exists", "conflict")

structureRoutes.post("/trajectories", validate("json", createTrajectoryBody), async (c) => {
  requireAdmin(c)
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  const body = c.req.valid("json")
  const last = await db
    .select({ value: max(trajectories.position) })
    .from(trajectories)
    .where(eq(trajectories.programmeId, programmeId))
    .get()
  try {
    const row = await db
      .insert(trajectories)
      .values({ programmeId, name: body.name, color: body.color ?? "", position: (last?.value ?? -1) + 1 })
      .returning({ id: trajectories.id })
      .get()
    notify(c, "structure")
    return c.json({ id: row.id }, 201)
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateName()
    throw error
  }
})

structureRoutes.patch("/trajectories/:tid", validate("json", updateTrajectoryBody), async (c) => {
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  const id = intParam(c.req.param("tid"))
  requireTrajectoryEditor(c, id)
  const { version, ...changes } = c.req.valid("json")
  try {
    const result = await db
      .update(trajectories)
      .set({ ...changes, version: sql`${trajectories.version} + 1` })
      .where(
        and(
          eq(trajectories.id, id),
          eq(trajectories.programmeId, programmeId),
          eq(trajectories.version, version),
        ),
      )
      .run()
    await assertVersionedUpdate(result, async () => Boolean(await getTrajectory(db, programmeId, id)))
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateName()
    throw error
  }
  notify(c, "structure")
  return c.json({ ok: true })
})

structureRoutes.delete("/trajectories/:tid", async (c) => {
  requireAdmin(c)
  const db = c.get("db")
  const id = intParam(c.req.param("tid"))
  await getTrajectory(db, c.get("programmeId"), id)
  await db.delete(trajectories).where(eq(trajectories.id, id))
  notify(c, "structure", "coverage", "justifications")
  return c.json({ ok: true })
})

// ── LTOs ────────────────────────────────────────────────────────────────────

async function getLto(db: Db, programmeId: string, id: number): Promise<LtoRow> {
  return found(
    await db
      .select()
      .from(ltos)
      .where(and(eq(ltos.id, id), eq(ltos.programmeId, programmeId)))
      .get(),
    "LTO not found",
  )
}

structureRoutes.post("/trajectories/:tid/ltos", validate("json", createLtoBody), async (c) => {
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  const trajectoryId = intParam(c.req.param("tid"))
  requireTrajectoryEditor(c, trajectoryId)
  await getTrajectory(db, programmeId, trajectoryId)
  const body = c.req.valid("json")
  const last = await db
    .select({ value: max(ltos.position) })
    .from(ltos)
    .where(eq(ltos.trajectoryId, trajectoryId))
    .get()
  try {
    const row = await db
      .insert(ltos)
      .values({ ...body, programmeId, trajectoryId, position: (last?.value ?? -1) + 1 })
      .returning({ id: ltos.id })
      .get()
    notify(c, "structure", "courses")
    return c.json({ id: row.id }, 201)
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateCode()
    throw error
  }
})

structureRoutes.patch("/ltos/:lid", validate("json", updateLtoBody), async (c) => {
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  const id = intParam(c.req.param("lid"))
  const current = await getLto(db, programmeId, id)
  requireTrajectoryEditor(c, current.trajectoryId)
  const { version, ...changes } = c.req.valid("json")
  if (changes.trajectoryId !== undefined && changes.trajectoryId !== current.trajectoryId) {
    requireTrajectoryEditor(c, changes.trajectoryId)
    await getTrajectory(db, programmeId, changes.trajectoryId)
  }
  try {
    const result = await db
      .update(ltos)
      .set({ ...changes, version: sql`${ltos.version} + 1` })
      .where(and(eq(ltos.id, id), eq(ltos.version, version)))
      .run()
    await assertVersionedUpdate(result, async () => true)
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateCode()
    throw error
  }
  // Changing what an LTO means makes existing links stale.
  const affectsLinking = changes.title !== undefined || changes.narrative !== undefined || changes.code !== undefined
  if (affectsLinking) notify(c, "structure", "courses")
  else notify(c, "structure")
  return c.json({ ok: true })
})

structureRoutes.delete("/ltos/:lid", async (c) => {
  const db = c.get("db")
  const id = intParam(c.req.param("lid"))
  const current = await getLto(db, c.get("programmeId"), id)
  requireTrajectoryEditor(c, current.trajectoryId)
  await db.delete(ltos).where(eq(ltos.id, id))
  notify(c, "structure", "coverage", "courses", "justifications")
  return c.json({ ok: true })
})

/** Create or update trajectories and LTOs from rows (e.g. a CSV export of the prototype). */
structureRoutes.post("/ltos/import", validate("json", importLtosBody), async (c) => {
  requireAdmin(c)
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  const { rows } = c.req.valid("json")
  const structure = await loadStructure(db, programmeId)
  const trajectoryIds = new Map(structure.trajectories.map((t) => [t.name, t.id]))
  const existingLtos = new Map(
    structure.trajectories.flatMap((t) => t.ltos).map((l) => [l.code, l]),
  )
  const result: ImportLtosResponse = { trajectoriesCreated: 0, ltosCreated: 0, ltosUpdated: 0 }
  let trajectoryPosition = structure.trajectories.length
  const ltoPositions = new Map(structure.trajectories.map((t) => [t.id, t.ltos.length]))

  for (const row of rows) {
    let trajectoryId = trajectoryIds.get(row.trajectory)
    if (trajectoryId === undefined) {
      const created = await db
        .insert(trajectories)
        .values({ programmeId, name: row.trajectory, position: trajectoryPosition++ })
        .returning({ id: trajectories.id })
        .get()
      trajectoryId = created.id
      trajectoryIds.set(row.trajectory, trajectoryId)
      result.trajectoriesCreated++
    }
    const existing = existingLtos.get(row.code)
    if (existing) {
      await db
        .update(ltos)
        .set({ title: row.title, trajectoryId, version: sql`${ltos.version} + 1` })
        .where(eq(ltos.id, existing.id))
      result.ltosUpdated++
    } else {
      const position = ltoPositions.get(trajectoryId) ?? 0
      ltoPositions.set(trajectoryId, position + 1)
      const created = await db
        .insert(ltos)
        .values({ programmeId, trajectoryId, code: row.code, title: row.title, position })
        .returning()
        .get()
      existingLtos.set(row.code, toLtoDto(created))
      result.ltosCreated++
    }
  }
  notify(c, "structure", "courses")
  return c.json(result)
})
