import { and, asc, eq, max, sql } from "drizzle-orm"
import { Hono } from "hono"
import {
  createFieldBody,
  createFrameworkBody,
  createIndicatorBody,
  updateFieldBody,
  updateFrameworkBody,
  updateIndicatorBody,
  upsertJustificationBody,
  type FieldDto,
  type FrameworkDto,
  type JustificationDto,
} from "@shared/api"
import { actorEmail, requireAdmin, requireTrajectoryEditor } from "../access"
import type { ProgrammeEnv } from "../context"
import type { Db } from "../db/client"
import { assertChanged, assertVersionedUpdate, isUniqueViolation } from "../db/helpers"
import { extractionFields, frameworks, indicators, justifications, ltos } from "../db/schema"
import { HttpError, found, invalid } from "../errors"
import { intParam, validate } from "../validation"
import { notify } from "./notify"

export const frameworkRoutes = new Hono<ProgrammeEnv>()

// ── Frameworks & indicators ─────────────────────────────────────────────────

frameworkRoutes.get("/frameworks", async (c) => {
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  const [frameworkRows, indicatorRows] = await Promise.all([
    db
      .select()
      .from(frameworks)
      .where(eq(frameworks.programmeId, programmeId))
      .orderBy(asc(frameworks.position), asc(frameworks.id)),
    db
      .select()
      .from(indicators)
      .where(eq(indicators.programmeId, programmeId))
      .orderBy(asc(indicators.position), asc(indicators.id)),
  ])
  const result: FrameworkDto[] = frameworkRows.map((f) => ({
    id: f.id,
    name: f.name,
    description: f.description,
    position: f.position,
    indicators: indicatorRows
      .filter((i) => i.frameworkId === f.id)
      .map((i) => ({
        id: i.id,
        frameworkId: i.frameworkId,
        code: i.code,
        name: i.name,
        description: i.description,
        position: i.position,
      })),
  }))
  return c.json(result)
})

frameworkRoutes.post("/frameworks", validate("json", createFrameworkBody), async (c) => {
  requireAdmin(c)
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  const last = await db
    .select({ value: max(frameworks.position) })
    .from(frameworks)
    .where(eq(frameworks.programmeId, programmeId))
    .get()
  const body = c.req.valid("json")
  const row = await db
    .insert(frameworks)
    .values({ ...body, programmeId, position: (last?.value ?? -1) + 1 })
    .returning({ id: frameworks.id })
    .get()
  notify(c, "frameworks")
  return c.json({ id: row.id }, 201)
})

frameworkRoutes.patch("/frameworks/:fid", validate("json", updateFrameworkBody), async (c) => {
  requireAdmin(c)
  const result = await c
    .get("db")
    .update(frameworks)
    .set(c.req.valid("json"))
    .where(and(eq(frameworks.id, intParam(c.req.param("fid"))), eq(frameworks.programmeId, c.get("programmeId"))))
    .run()
  assertChanged(result, "Framework not found")
  notify(c, "frameworks")
  return c.json({ ok: true })
})

frameworkRoutes.delete("/frameworks/:fid", async (c) => {
  requireAdmin(c)
  const result = await c
    .get("db")
    .delete(frameworks)
    .where(and(eq(frameworks.id, intParam(c.req.param("fid"))), eq(frameworks.programmeId, c.get("programmeId"))))
    .run()
  assertChanged(result, "Framework not found")
  notify(c, "frameworks", "justifications")
  return c.json({ ok: true })
})

frameworkRoutes.post(
  "/frameworks/:fid/indicators",
  validate("json", createIndicatorBody),
  async (c) => {
    requireAdmin(c)
    const db = c.get("db")
    const programmeId = c.get("programmeId")
    const frameworkId = intParam(c.req.param("fid"))
    found(
      await db
        .select({ id: frameworks.id })
        .from(frameworks)
        .where(and(eq(frameworks.id, frameworkId), eq(frameworks.programmeId, programmeId)))
        .get(),
      "Framework not found",
    )
    const last = await db
      .select({ value: max(indicators.position) })
      .from(indicators)
      .where(eq(indicators.frameworkId, frameworkId))
      .get()
    const row = await db
      .insert(indicators)
      .values({ ...c.req.valid("json"), programmeId, frameworkId, position: (last?.value ?? -1) + 1 })
      .returning({ id: indicators.id })
      .get()
    notify(c, "frameworks")
    return c.json({ id: row.id }, 201)
  },
)

frameworkRoutes.patch("/indicators/:iid", validate("json", updateIndicatorBody), async (c) => {
  requireAdmin(c)
  const result = await c
    .get("db")
    .update(indicators)
    .set(c.req.valid("json"))
    .where(and(eq(indicators.id, intParam(c.req.param("iid"))), eq(indicators.programmeId, c.get("programmeId"))))
    .run()
  assertChanged(result, "Indicator not found")
  notify(c, "frameworks")
  return c.json({ ok: true })
})

frameworkRoutes.delete("/indicators/:iid", async (c) => {
  requireAdmin(c)
  const result = await c
    .get("db")
    .delete(indicators)
    .where(and(eq(indicators.id, intParam(c.req.param("iid"))), eq(indicators.programmeId, c.get("programmeId"))))
    .run()
  assertChanged(result, "Indicator not found")
  notify(c, "frameworks", "justifications")
  return c.json({ ok: true })
})

// ── Justifications ──────────────────────────────────────────────────────────

frameworkRoutes.get("/justifications", async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(justifications)
    .where(eq(justifications.programmeId, c.get("programmeId")))
  const result: JustificationDto[] = rows.map((r) => ({
    ltoId: r.ltoId,
    indicatorId: r.indicatorId,
    text: r.text,
    version: r.version,
    updatedAt: r.updatedAt,
    updatedBy: r.updatedBy,
  }))
  return c.json(result)
})

frameworkRoutes.put(
  "/ltos/:lid/justifications/:iid",
  validate("json", upsertJustificationBody),
  async (c) => {
    const db = c.get("db")
    const programmeId = c.get("programmeId")
    const ltoId = intParam(c.req.param("lid"))
    const indicatorId = intParam(c.req.param("iid"))
    const lto = found(
      await db
        .select({ trajectoryId: ltos.trajectoryId })
        .from(ltos)
        .where(and(eq(ltos.id, ltoId), eq(ltos.programmeId, programmeId)))
        .get(),
      "LTO not found",
    )
    requireTrajectoryEditor(c, lto.trajectoryId)
    found(
      await db
        .select({ id: indicators.id })
        .from(indicators)
        .where(and(eq(indicators.id, indicatorId), eq(indicators.programmeId, programmeId)))
        .get(),
      "Indicator not found",
    )
    const { text, version } = c.req.valid("json")
    const updatedBy = actorEmail(c)
    if (version === null) {
      try {
        await db
          .insert(justifications)
          .values({ ltoId, indicatorId, programmeId, text, updatedBy, updatedAt: Date.now() })
      } catch (error) {
        if (isUniqueViolation(error)) throw new HttpError(409, "Someone else wrote this justification in the meantime. Reload and try again.", "conflict")
        throw error
      }
    } else {
      const result = await db
        .update(justifications)
        .set({ text, updatedBy, updatedAt: Date.now(), version: sql`${justifications.version} + 1` })
        .where(
          and(
            eq(justifications.ltoId, ltoId),
            eq(justifications.indicatorId, indicatorId),
            eq(justifications.version, version),
          ),
        )
        .run()
      await assertVersionedUpdate(result, async () => true)
    }
    notify(c, "justifications")
    return c.json({ ok: true })
  },
)

// ── Extraction fields ───────────────────────────────────────────────────────

type FieldRow = typeof extractionFields.$inferSelect

export function toFieldDto(row: FieldRow): FieldDto {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    type: row.type,
    prompt: row.prompt,
    required: row.required,
    system: row.system,
    position: row.position,
  }
}

export async function loadFields(db: Db, programmeId: string): Promise<FieldDto[]> {
  const rows = await db
    .select()
    .from(extractionFields)
    .where(eq(extractionFields.programmeId, programmeId))
    .orderBy(asc(extractionFields.position), asc(extractionFields.id))
  return rows.map(toFieldDto)
}

frameworkRoutes.get("/fields", async (c) => {
  return c.json(await loadFields(c.get("db"), c.get("programmeId")))
})

frameworkRoutes.post("/fields", validate("json", createFieldBody), async (c) => {
  requireAdmin(c)
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  const last = await db
    .select({ value: max(extractionFields.position) })
    .from(extractionFields)
    .where(eq(extractionFields.programmeId, programmeId))
    .get()
  try {
    const row = await db
      .insert(extractionFields)
      .values({ ...c.req.valid("json"), programmeId, system: false, position: (last?.value ?? -1) + 1 })
      .returning({ id: extractionFields.id })
      .get()
    notify(c, "fields", "courses")
    return c.json({ id: row.id }, 201)
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "A field with this key already exists", "conflict")
    throw error
  }
})

async function getField(db: Db, programmeId: string, id: number): Promise<FieldRow> {
  return found(
    await db
      .select()
      .from(extractionFields)
      .where(and(eq(extractionFields.id, id), eq(extractionFields.programmeId, programmeId)))
      .get(),
    "Field not found",
  )
}

frameworkRoutes.patch("/fields/:id", validate("json", updateFieldBody), async (c) => {
  requireAdmin(c)
  const db = c.get("db")
  const field = await getField(db, c.get("programmeId"), intParam(c.req.param("id")))
  const changes = c.req.valid("json")
  if (field.system && changes.type !== undefined) {
    throw invalid("The type of a system field cannot be changed")
  }
  await db.update(extractionFields).set(changes).where(eq(extractionFields.id, field.id))
  notify(c, "fields", "courses")
  return c.json({ ok: true })
})

frameworkRoutes.delete("/fields/:id", async (c) => {
  requireAdmin(c)
  const db = c.get("db")
  const field = await getField(db, c.get("programmeId"), intParam(c.req.param("id")))
  if (field.system) throw invalid("System fields cannot be removed")
  await db.delete(extractionFields).where(eq(extractionFields.id, field.id))
  notify(c, "fields", "courses")
  return c.json({ ok: true })
})
