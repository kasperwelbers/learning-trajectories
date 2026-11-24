import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import {
  analyzeBody,
  bulkCreateCoursesBody,
  createCourseBody,
  importPreviewBody,
  updateCourseBody,
  yearQuerySchema,
  type CourseDetailResponse,
  type CourseSummaryDto,
  type CoursesResponse,
  type DocumentDto,
  type ManualHealth,
  type RelinkResponse,
} from "@shared/api"
import { academicYearSchema, sortAcademicYears } from "@shared/academicYear"
import { documentKindSchema } from "@shared/evidence"
import { courseTopic } from "@shared/topics"
import { actorEmail, requireAdmin, requireCourseEditor } from "../access"
import { sha256Hex } from "../auth/crypto"
import type { ProgrammeEnv } from "../context"
import type { Db } from "../db/client"
import { inChunks } from "../db/batching"
import { isUniqueViolation } from "../db/helpers"
import { analyses, analysisFields, courses, disputes, documents, links, pointers } from "../db/schema"
import { HttpError, found, invalid } from "../errors"
import { proposeCoursesFromUrls } from "../pipeline/importCourses"
import { loadAnalysisDto } from "../services/analysisDetail"
import { startAnalysis } from "../services/analysisRunner"
import { courseFacts, coursesWithAnalyses } from "../services/courseFacts"
import {
  DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  documentKey,
  documentMimeType,
} from "../services/files"
import { currentLtoHash, documentsHashes } from "../services/hashes"
import { intParam, validate } from "../validation"
import { loadFields } from "./frameworks"
import { notify } from "./notify"
import { toDisputeDto, toPointerDto } from "./feedback"

export const courseRoutes = new Hono<ProgrammeEnv>()

type CourseRow = typeof courses.$inferSelect
type DocumentRow = typeof documents.$inferSelect

export async function getCourse(db: Db, programmeId: string, id: number): Promise<CourseRow> {
  return found(
    await db
      .select()
      .from(courses)
      .where(and(eq(courses.id, id), eq(courses.programmeId, programmeId)))
      .get(),
    "Course not found",
  )
}

function toDocumentDto(row: DocumentRow): DocumentDto {
  return {
    id: row.id,
    year: row.year,
    kind: row.kind,
    filename: row.filename,
    mimeType: row.mimeType,
    size: row.size,
    uploadedAt: row.uploadedAt,
    uploadedBy: row.uploadedBy,
  }
}

/** Whether an analysis' results no longer match the current LTOs or documents. */
function isStale(
  analysis: { ltoHash: string | null; documentsHash: string | null; courseId: number; year: string; hasResults: boolean },
  ltoHash: string,
  docHashes: Map<string, string>,
): boolean {
  if (!analysis.hasResults) return false
  return (
    analysis.ltoHash !== ltoHash ||
    analysis.documentsHash !== (docHashes.get(`${analysis.courseId}|${analysis.year}`) ?? null)
  )
}

// ── List & create ───────────────────────────────────────────────────────────

courseRoutes.get("/courses", validate("query", yearQuerySchema), async (c) => {
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  const { year } = c.req.valid("query")
  const items = await coursesWithAnalyses(db, programmeId, year)
  const [facts, fields, ltoHash, docHashes, manualRows, disputeRows] = await Promise.all([
    courseFacts(db, items),
    loadFields(db, programmeId),
    currentLtoHash(db, programmeId),
    documentsHashes(db, programmeId),
    db
      .select({ courseId: documents.courseId })
      .from(documents)
      .where(and(eq(documents.programmeId, programmeId), eq(documents.year, year), eq(documents.kind, "manual"))),
    db
      .select({ courseId: disputes.courseId, n: sql<number>`count(*)` })
      .from(disputes)
      .where(and(eq(disputes.programmeId, programmeId), eq(disputes.status, "open")))
      .groupBy(disputes.courseId),
  ])
  const effectiveIds = items.flatMap((i) => (i.effective ? [i.effective.id] : []))
  const [fieldRows, linkCounts] = await Promise.all([
    inChunks(effectiveIds, (chunk) =>
      db
        .select({ analysisId: analysisFields.analysisId, key: analysisFields.key, status: analysisFields.status })
        .from(analysisFields)
        .where(inArray(analysisFields.analysisId, chunk)),
    ),
    inChunks(effectiveIds, (chunk) =>
      db
        .select({ analysisId: links.analysisId, n: sql<number>`count(*)` })
        .from(links)
        .where(inArray(links.analysisId, chunk))
        .groupBy(links.analysisId),
    ),
  ])
  const hasManual = new Set(manualRows.map((r) => r.courseId))
  const openDisputes = new Map(disputeRows.map((r) => [r.courseId, r.n]))
  const linkCount = new Map(linkCounts.map((r) => [r.analysisId, r.n]))

  const result: CourseSummaryDto[] = items.map((item, i) => {
    const { effective, current } = item
    let health: ManualHealth | null = null
    if (effective) {
      const statuses = new Map(
        fieldRows.filter((r) => r.analysisId === effective.id).map((r) => [r.key, r.status]),
      )
      health = { found: 0, unclear: 0, missing: 0, requiredProblems: [] }
      for (const field of fields) {
        const status = statuses.get(field.key) ?? "missing"
        health[status]++
        if (field.required && status !== "found") health.requiredProblems.push(field.label)
      }
    }
    const fact = facts[i]
    if (!fact) throw new Error("course facts out of sync")
    return {
      ...fact,
      status: current?.status ?? null,
      step: current?.step ?? null,
      hasManual: hasManual.has(item.course.id),
      health,
      stale: effective ? isStale(effective, ltoHash, docHashes) : false,
      linkCount: effective ? (linkCount.get(effective.id) ?? 0) : 0,
      openDisputes: openDisputes.get(item.course.id) ?? 0,
    }
  })
  return c.json<CoursesResponse>({ year, courses: result })
})

courseRoutes.post("/courses", validate("json", createCourseBody), async (c) => {
  requireAdmin(c)
  try {
    const row = await c
      .get("db")
      .insert(courses)
      .values({ ...c.req.valid("json"), programmeId: c.get("programmeId") })
      .returning({ id: courses.id })
      .get()
    notify(c, "courses", "coverage")
    return c.json({ id: row.id }, 201)
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "A course with this code already exists", "conflict")
    throw error
  }
})

courseRoutes.post("/courses/bulk", validate("json", bulkCreateCoursesBody), async (c) => {
  requireAdmin(c)
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  let created = 0
  for (const course of c.req.valid("json").courses) {
    const result = await db
      .insert(courses)
      .values({ ...course, programmeId })
      .onConflictDoNothing()
      .run()
    created += result.meta.changes
  }
  notify(c, "courses", "coverage")
  return c.json({ created })
})

courseRoutes.post("/courses/import-preview", validate("json", importPreviewBody), async (c) => {
  requireAdmin(c)
  const db = c.get("db")
  const existing = await db
    .select({ code: courses.code })
    .from(courses)
    .where(eq(courses.programmeId, c.get("programmeId")))
  const preview = await proposeCoursesFromUrls(c.env, c.req.valid("json").urls)
  const codes = new Set(existing.map((e) => e.code.toLowerCase()))
  return c.json({
    ...preview,
    courses: preview.courses.map((course) => ({ ...course, exists: codes.has(course.code.toLowerCase()) })),
  })
})

courseRoutes.patch("/courses/:cid", validate("json", updateCourseBody), async (c) => {
  requireAdmin(c)
  const db = c.get("db")
  const course = await getCourse(db, c.get("programmeId"), intParam(c.req.param("cid")))
  try {
    await db.update(courses).set(c.req.valid("json")).where(eq(courses.id, course.id))
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "A course with this code already exists", "conflict")
    throw error
  }
  notify(c, "courses", "coverage", courseTopic(course.id))
  return c.json({ ok: true })
})

courseRoutes.delete("/courses/:cid", async (c) => {
  requireAdmin(c)
  const db = c.get("db")
  const course = await getCourse(db, c.get("programmeId"), intParam(c.req.param("cid")))
  const docs = await db.select({ key: documents.r2Key }).from(documents).where(eq(documents.courseId, course.id))
  await db.delete(courses).where(eq(courses.id, course.id))
  if (docs.length > 0) await c.env.FILES.delete(docs.map((d) => d.key))
  notify(c, "courses", "coverage", "programme")
  return c.json({ ok: true })
})

// ── Course detail ───────────────────────────────────────────────────────────

courseRoutes.get("/courses/:cid", validate("query", yearQuerySchema), async (c) => {
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  const { year } = c.req.valid("query")
  const course = await getCourse(db, programmeId, intParam(c.req.param("cid")))
  const [docRows, analysis, disputeRows, pointerRows, fields, ltoHash, docHashes] = await Promise.all([
    db.select().from(documents).where(eq(documents.courseId, course.id)).orderBy(desc(documents.uploadedAt)),
    db
      .select()
      .from(analyses)
      .where(and(eq(analyses.courseId, course.id), eq(analyses.year, year)))
      .get(),
    db.select().from(disputes).where(and(eq(disputes.courseId, course.id), eq(disputes.year, year))).orderBy(desc(disputes.createdAt)),
    db.select().from(pointers).where(and(eq(pointers.courseId, course.id), eq(pointers.year, year))).orderBy(desc(pointers.createdAt)),
    loadFields(db, programmeId),
    currentLtoHash(db, programmeId),
    documentsHashes(db, programmeId),
  ])
  const response: CourseDetailResponse = {
    course: { id: course.id, code: course.code, name: course.name },
    year,
    documentYears: sortAcademicYears(docRows.map((d) => d.year)),
    documents: docRows.filter((d) => d.year === year).map(toDocumentDto),
    analysis: analysis
      ? await loadAnalysisDto(db, analysis, fields, isStale(analysis, ltoHash, docHashes))
      : null,
    disputes: disputeRows.flatMap(toDisputeDto),
    pointers: pointerRows.map(toPointerDto),
  }
  return c.json(response)
})

// ── Documents ───────────────────────────────────────────────────────────────

const uploadFormSchema = z.object({
  year: academicYearSchema,
  kind: documentKindSchema,
})

courseRoutes.post("/courses/:cid/documents", async (c) => {
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  const course = await getCourse(db, programmeId, intParam(c.req.param("cid")))
  requireCourseEditor(c, course.id)
  const form = await c.req.parseBody()
  const meta = uploadFormSchema.safeParse({ year: form.year, kind: form.kind })
  if (!meta.success) throw invalid("Missing year or document kind")
  const file = form.file
  if (!(file instanceof File)) throw invalid("No file uploaded")
  if (file.size > MAX_DOCUMENT_BYTES) throw invalid("Files can be at most 25 MB")
  const mimeType = documentMimeType(file)
  if (!mimeType) {
    throw invalid(`Unsupported file type. Upload ${Object.values(DOCUMENT_TYPES).join(", ")}.`)
  }
  const { year, kind } = meta.data
  const bytes = await file.arrayBuffer()
  const key = documentKey(programmeId, course.id, file.name)
  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: mimeType } })

  // A course has one manual per year: replace the previous one.
  const replaced =
    kind === "manual"
      ? await db
          .select()
          .from(documents)
          .where(and(eq(documents.courseId, course.id), eq(documents.year, year), eq(documents.kind, "manual")))
      : []
  const row = await db
    .insert(documents)
    .values({
      programmeId,
      courseId: course.id,
      year,
      kind,
      filename: file.name,
      mimeType,
      size: file.size,
      sha256: await sha256Hex(bytes),
      r2Key: key,
      uploadedBy: actorEmail(c),
    })
    .returning({ id: documents.id })
    .get()
  if (replaced.length > 0) {
    await db.delete(documents).where(inArray(documents.id, replaced.map((d) => d.id)))
    await c.env.FILES.delete(replaced.map((d) => d.r2Key))
  }
  // A new manual is the common case for a fresh analysis; start it right away.
  if (kind === "manual") await startAnalysis(c.env, db, programmeId, course.id, year)
  notify(c, courseTopic(course.id), "courses", "programme")
  return c.json({ id: row.id }, 201)
})

async function getDocument(db: Db, programmeId: string, id: number): Promise<DocumentRow> {
  return found(
    await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.programmeId, programmeId)))
      .get(),
    "Document not found",
  )
}

courseRoutes.get("/documents/:did/file", async (c) => {
  const doc = await getDocument(c.get("db"), c.get("programmeId"), intParam(c.req.param("did")))
  const object = found(await c.env.FILES.get(doc.r2Key), "File not found")
  return new Response(object.body, {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `inline; filename="${doc.filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=3600",
    },
  })
})

courseRoutes.delete("/documents/:did", async (c) => {
  const db = c.get("db")
  const doc = await getDocument(db, c.get("programmeId"), intParam(c.req.param("did")))
  requireCourseEditor(c, doc.courseId)
  await db.delete(documents).where(eq(documents.id, doc.id))
  await c.env.FILES.delete(doc.r2Key)
  notify(c, courseTopic(doc.courseId), "courses", "coverage", "programme")
  return c.json({ ok: true })
})

// ── Analyses ────────────────────────────────────────────────────────────────

courseRoutes.post("/courses/:cid/analyze", validate("json", analyzeBody), async (c) => {
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  const course = await getCourse(db, programmeId, intParam(c.req.param("cid")))
  requireCourseEditor(c, course.id)
  await startAnalysis(c.env, db, programmeId, course.id, c.req.valid("json").year)
  notify(c, courseTopic(course.id), "courses")
  return c.json({ ok: true })
})

/** Re-run analyses whose results are stale (e.g. after LTO narratives changed). */
courseRoutes.post("/relink", validate("json", analyzeBody), async (c) => {
  requireAdmin(c)
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  const { year } = c.req.valid("json")
  const [items, ltoHash, docHashes] = await Promise.all([
    coursesWithAnalyses(db, programmeId, year),
    currentLtoHash(db, programmeId),
    documentsHashes(db, programmeId),
  ])
  let started = 0
  for (const { current } of items) {
    if (current && current.status !== "running" && current.status !== "queued" && isStale(current, ltoHash, docHashes)) {
      await startAnalysis(c.env, db, programmeId, current.courseId, current.year)
      started++
    }
  }
  notify(c, "courses")
  return c.json<RelinkResponse>({ started })
})
