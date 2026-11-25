import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import {
  analyzeBody,
  bulkCreateCoursesBody,
  fetchStudyGuideBody,
  createCourseBody,
  importPreviewBody,
  updateCourseBody,
  yearQuerySchema,
  type CourseDetailResponse,
  type CourseSummaryDto,
  type CoursesResponse,
  type DocumentDto,
  type FetchStudyGuidesResponse,
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
import { analyses, analysisFields, courses, disputes, documents, links, pointers, programmes } from "../db/schema"
import { HttpError, found, invalid } from "../errors"
import { proposeCoursesFromUrls } from "../pipeline/importCourses"
import { loadAnalysisDto } from "../services/analysisDetail"
import { startAnalysis, startLtoRelink } from "../services/analysisRunner"
import { saveStudyGuide, studyGuideUrl } from "../services/studyGuide"
import { courseFacts, coursesWithAnalyses } from "../services/courseFacts"
import {
  DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  documentKey,
  documentMimeType,
} from "../services/files"
import { loadStaleness } from "../services/staleness"
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
    sourceUrl: row.sourceUrl,
    uploadedAt: row.uploadedAt,
    uploadedBy: row.uploadedBy,
  }
}

// ── List & create ───────────────────────────────────────────────────────────

courseRoutes.get("/courses", validate("query", yearQuerySchema), async (c) => {
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  const { year } = c.req.valid("query")
  const items = await coursesWithAnalyses(db, programmeId, year)
  const effectiveIds = items.flatMap((i) => (i.effective ? [i.effective.id] : []))
  const [facts, fields, staleness, descriptionRows, disputeRows] = await Promise.all([
    courseFacts(db, items),
    loadFields(db, programmeId),
    loadStaleness(db, programmeId, effectiveIds),
    db
      .select({ courseId: documents.courseId, kind: documents.kind })
      .from(documents)
      .where(
        and(
          eq(documents.programmeId, programmeId),
          eq(documents.year, year),
          inArray(documents.kind, ["manual", "study_guide"]),
        ),
      ),
    db
      .select({ courseId: disputes.courseId, n: sql<number>`count(*)` })
      .from(disputes)
      .where(and(eq(disputes.programmeId, programmeId), eq(disputes.status, "open")))
      .groupBy(disputes.courseId),
  ])
  const [fieldRows, linkCounts] = await Promise.all([
    inChunks(effectiveIds, (chunk) =>
      db
        .select({
          analysisId: analysisFields.analysisId,
          key: analysisFields.key,
          status: analysisFields.status,
          source: analysisFields.source,
        })
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
  const hasManual = new Set(descriptionRows.filter((r) => r.kind === "manual").map((r) => r.courseId))
  const hasStudyGuide = new Set(descriptionRows.filter((r) => r.kind === "study_guide").map((r) => r.courseId))
  const openDisputes = new Map(disputeRows.map((r) => [r.courseId, r.n]))
  const linkCount = new Map(linkCounts.map((r) => [r.analysisId, r.n]))

  const result: CourseSummaryDto[] = items.map((item, i) => {
    const { effective, current } = item
    let health: ManualHealth | null = null
    const effectiveFields = effective ? fieldRows.filter((r) => r.analysisId === effective.id) : []
    // Health is about the manual: values that only the study guide provided count as missing.
    if (effectiveFields.some((r) => r.source === "manual")) {
      const statuses = new Map(
        effectiveFields.map((r) => [r.key, r.source === "manual" ? r.status : ("missing" as const)]),
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
      hasStudyGuide: hasStudyGuide.has(item.course.id),
      health,
      stale: effective ? staleness.isStale(effective) : false,
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
  const [docRows, analysis, disputeRows, pointerRows, fields] = await Promise.all([
    db.select().from(documents).where(eq(documents.courseId, course.id)).orderBy(desc(documents.uploadedAt)),
    db
      .select()
      .from(analyses)
      .where(and(eq(analyses.courseId, course.id), eq(analyses.year, year)))
      .get(),
    db.select().from(disputes).where(and(eq(disputes.courseId, course.id), eq(disputes.year, year))).orderBy(desc(disputes.createdAt)),
    db.select().from(pointers).where(and(eq(pointers.courseId, course.id), eq(pointers.year, year))).orderBy(desc(pointers.createdAt)),
    loadFields(db, programmeId),
  ])
  const staleness = await loadStaleness(db, programmeId, analysis ? [analysis.id] : [])
  const response: CourseDetailResponse = {
    course: { id: course.id, code: course.code, name: course.name, programmeYear: course.programmeYear },
    year,
    documentYears: sortAcademicYears(docRows.map((d) => d.year)),
    documents: docRows.filter((d) => d.year === year).map(toDocumentDto),
    analysis: analysis
      ? await loadAnalysisDto(db, analysis, fields, staleness)
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

  // A course has one manual and one study guide per year: replace the previous one.
  const singular = kind === "manual" || kind === "study_guide"
  const replaced =
    singular
      ? await db
          .select()
          .from(documents)
          .where(and(eq(documents.courseId, course.id), eq(documents.year, year), eq(documents.kind, kind)))
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
  // A new course description is the common case for a fresh analysis; start it right away.
  // After supplementary uploads the course shows as stale, so several files can be added first.
  if (singular) await startAnalysis(c.env, db, programmeId, course.id, year)
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

/**
 * Bring stale results up to date: analyses whose documents changed are redone completely;
 * LTOs that changed since they were linked are re-linked (across all courses, one job per LTO).
 */
courseRoutes.post("/relink", async (c) => {
  requireAdmin(c)
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  const analysisRows = await db
    .select()
    .from(analyses)
    .where(and(eq(analyses.programmeId, programmeId), eq(analyses.hasResults, true)))
  const staleness = await loadStaleness(db, programmeId, analysisRows.map((a) => a.id))
  const busy = (a: (typeof analysisRows)[number]) => a.status === "running" || a.status === "queued"
  let analysesStarted = 0
  const staleLtos = new Set<number>()
  for (const analysis of analysisRows) {
    if (busy(analysis)) continue
    if (staleness.documentsChanged(analysis)) {
      await startAnalysis(c.env, db, programmeId, analysis.courseId, analysis.year)
      analysesStarted++
    } else {
      for (const ltoId of staleness.staleLtos(analysis)) staleLtos.add(ltoId)
    }
  }
  for (const ltoId of staleLtos) await startLtoRelink(c.env, db, ltoId, 0)
  notify(c, "courses")
  return c.json<RelinkResponse>({ analysesStarted, ltosRelinked: staleLtos.size })
})

// ── Study guide ─────────────────────────────────────────────────────────────

/** Fetch a course's study guide page for a year and analyse the course with it. */
courseRoutes.post("/courses/:cid/study-guide", validate("json", fetchStudyGuideBody), async (c) => {
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  const course = await getCourse(db, programmeId, intParam(c.req.param("cid")))
  requireCourseEditor(c, course.id)
  const { year, url } = c.req.valid("json")
  await saveStudyGuide(c.env, db, { programmeId, course, year, url, uploadedBy: actorEmail(c) })
  await startAnalysis(c.env, db, programmeId, course.id, year)
  notify(c, courseTopic(course.id), "courses", "programme")
  return c.json({ ok: true }, 201)
})

/** Fetch the study guide pages of all courses, using the programme's URL template. */
courseRoutes.post("/study-guides/fetch", validate("json", analyzeBody), async (c) => {
  requireAdmin(c)
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  const { year } = c.req.valid("json")
  const programme = found(await db.select().from(programmes).where(eq(programmes.id, programmeId)).get())
  if (!programme.studyGuideUrlTemplate) throw invalid("Set the study guide URL template in the settings first")
  const courseRows = await db.select().from(courses).where(eq(courses.programmeId, programmeId))
  const result: FetchStudyGuidesResponse = { fetched: 0, failed: [] }
  for (const course of courseRows) {
    const url = studyGuideUrl(programme.studyGuideUrlTemplate, course.code, year)
    try {
      const changed = await saveStudyGuide(c.env, db, { programmeId, course, year, url, uploadedBy: actorEmail(c) })
      if (changed) await startAnalysis(c.env, db, programmeId, course.id, year)
      result.fetched++
    } catch (error) {
      result.failed.push({ code: course.code, error: error instanceof Error ? error.message : "Failed" })
    }
  }
  notify(c, "courses", "programme")
  return c.json(result)
})
