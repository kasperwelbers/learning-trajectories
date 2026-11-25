import { and, eq } from "drizzle-orm"
import { Hono } from "hono"
import {
  createDisputeBody,
  createPointerBody,
  updateDisputeBody,
  type DisputeDto,
  type PointerDto,
} from "@shared/api"
import { parseBloomRef } from "@shared/bloom"
import { courseTopic } from "@shared/topics"
import { actorEmail, requireCourseEditor } from "../access"
import type { ProgrammeEnv } from "../context"
import type { Db } from "../db/client"
import { disputes, documents, ltos, pointers } from "../db/schema"
import { found, invalid } from "../errors"
import { startPointerJudgement } from "../services/analysisRunner"
import { intParam, validate } from "../validation"
import { getCourse } from "./courses"
import { notify } from "./notify"

export const feedbackRoutes = new Hono<ProgrammeEnv>()

type DisputeRow = typeof disputes.$inferSelect
type PointerRow = typeof pointers.$inferSelect

/** Returns [] for rows whose Bloom reference is no longer valid. */
export function toDisputeDto(row: DisputeRow): DisputeDto[] {
  let ref: DisputeDto["ref"] = null
  if (row.domain !== null || row.level !== null) {
    ref = parseBloomRef(row.domain ?? "", row.level ?? "")
    if (!ref) return []
  }
  return [
    {
      id: row.id,
      courseId: row.courseId,
      year: row.year,
      ltoId: row.ltoId,
      ref,
      text: row.text,
      status: row.status,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
    },
  ]
}

export function toPointerDto(row: PointerRow): PointerDto {
  return {
    id: row.id,
    courseId: row.courseId,
    year: row.year,
    ltoId: row.ltoId,
    documentId: row.documentId,
    passage: row.passage,
    page: row.page,
    note: row.note,
    status: row.status,
    verdict: row.verdict,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  }
}

async function assertLto(db: Db, programmeId: string, ltoId: number): Promise<void> {
  found(
    await db
      .select({ id: ltos.id })
      .from(ltos)
      .where(and(eq(ltos.id, ltoId), eq(ltos.programmeId, programmeId)))
      .get(),
    "LTO not found",
  )
}

// ── Disputes ────────────────────────────────────────────────────────────────

feedbackRoutes.post("/courses/:cid/disputes", validate("json", createDisputeBody), async (c) => {
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  const course = await getCourse(db, programmeId, intParam(c.req.param("cid")))
  requireCourseEditor(c, course.id)
  const body = c.req.valid("json")
  await assertLto(db, programmeId, body.ltoId)
  const row = await db
    .insert(disputes)
    .values({
      programmeId,
      courseId: course.id,
      year: body.year,
      ltoId: body.ltoId,
      domain: body.ref?.domain ?? null,
      level: body.ref?.level ?? null,
      text: body.text,
      createdBy: actorEmail(c),
    })
    .returning({ id: disputes.id })
    .get()
  notify(c, courseTopic(course.id), "courses", "coverage")
  return c.json({ id: row.id }, 201)
})

async function getDispute(db: Db, programmeId: string, id: number): Promise<DisputeRow> {
  return found(
    await db
      .select()
      .from(disputes)
      .where(and(eq(disputes.id, id), eq(disputes.programmeId, programmeId)))
      .get(),
    "Dispute not found",
  )
}

feedbackRoutes.patch("/disputes/:id", validate("json", updateDisputeBody), async (c) => {
  const db = c.get("db")
  const dispute = await getDispute(db, c.get("programmeId"), intParam(c.req.param("id")))
  requireCourseEditor(c, dispute.courseId)
  const { status } = c.req.valid("json")
  await db
    .update(disputes)
    .set({ status, resolvedAt: status === "resolved" ? Date.now() : null })
    .where(eq(disputes.id, dispute.id))
  notify(c, courseTopic(dispute.courseId), "courses", "coverage")
  return c.json({ ok: true })
})

feedbackRoutes.delete("/disputes/:id", async (c) => {
  const db = c.get("db")
  const dispute = await getDispute(db, c.get("programmeId"), intParam(c.req.param("id")))
  requireCourseEditor(c, dispute.courseId)
  await db.delete(disputes).where(eq(disputes.id, dispute.id))
  notify(c, courseTopic(dispute.courseId), "courses", "coverage")
  return c.json({ ok: true })
})

// ── Pointers ────────────────────────────────────────────────────────────────

feedbackRoutes.post("/courses/:cid/pointers", validate("json", createPointerBody), async (c) => {
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  const course = await getCourse(db, programmeId, intParam(c.req.param("cid")))
  requireCourseEditor(c, course.id)
  const body = c.req.valid("json")
  await assertLto(db, programmeId, body.ltoId)
  const doc = found(
    await db
      .select({ courseId: documents.courseId, year: documents.year })
      .from(documents)
      .where(and(eq(documents.id, body.documentId), eq(documents.programmeId, programmeId)))
      .get(),
    "Document not found",
  )
  if (doc.courseId !== course.id || doc.year !== body.year) {
    throw invalid("The passage must come from one of this course's documents for the same year")
  }
  const row = await db
    .insert(pointers)
    .values({
      ...body,
      programmeId,
      courseId: course.id,
      createdBy: actorEmail(c),
    })
    .returning({ id: pointers.id })
    .get()
  await startPointerJudgement(c.env, db, row.id)
  notify(c, courseTopic(course.id))
  return c.json({ id: row.id }, 201)
})

feedbackRoutes.delete("/pointers/:id", async (c) => {
  const db = c.get("db")
  const pointer = found(
    await db
      .select()
      .from(pointers)
      .where(
        and(
          eq(pointers.id, intParam(c.req.param("id"))),
          eq(pointers.programmeId, c.get("programmeId")),
        ),
      )
      .get(),
    "Pointer not found",
  )
  requireCourseEditor(c, pointer.courseId)
  // Cascades to the links and statements created from it.
  await db.delete(pointers).where(eq(pointers.id, pointer.id))
  notify(c, courseTopic(pointer.courseId), "courses", "coverage")
  return c.json({ ok: true })
})
