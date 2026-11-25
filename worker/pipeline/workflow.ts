import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { NonRetryableError } from "cloudflare:workflows"
import { and, asc, eq, inArray } from "drizzle-orm"
import type { AnalysisStep, DocumentKind } from "@shared/evidence"
import type { FieldDefinition } from "@shared/fields"
import { courseTopic, type Topic } from "@shared/topics"
import { aiConfig } from "../ai"
import { InvalidModelOutput, LlmRequestError } from "../ai/types"
import { sha256Hex } from "../auth/crypto"
import { inChunks } from "../db/batching"
import { createDb, type Db } from "../db/client"
import {
  analyses,
  courses,
  documents,
  extractionCache,
  extractionFields,
  ltos,
  pointers,
  statements,
} from "../db/schema"
import { broadcast } from "../realtime/notify"
import type { WorkflowParams } from "../services/analysisRunner"
import { documentsHashOf, ltoHash } from "../services/hashes"
import { ltosForLinking } from "../services/linkingInput"
import {
  assembleExtractions,
  buildLinks,
  pointerRows,
  toLinkingStatements,
  type ExtractedDocument,
} from "./assemble"
import { documentPages } from "./documentText"
import { EXTRACTION_PROMPT_VERSION, extractDocument, parseCachedExtraction } from "./extract"
import { judgePassage, type Judgement } from "./judge"
import { LINKING_PROMPT_VERSION, linkLto, type LinkingCourse, type LinkingLto, type ProposedLink } from "./link"
import {
  saveAnalysisResults,
  saveLtoRelink,
  savePointerResult,
  type AnalysisResults,
  type StoredStatement,
} from "./store"
import { DocumentMatcher } from "./verify"

/**
 * Durable background jobs for the AI pipeline. Every step is retried on failure and its result
 * is persisted, so a crash halfway never repeats finished (and paid-for) model calls.
 */

interface DocumentRef {
  id: number
  kind: DocumentKind
  filename: string
  mimeType: string
  sha256: string
  r2Key: string
}

interface AnalysisContext {
  analysisId: number
  programmeId: string
  courseId: number
  year: string
  course: { code: string; name: string }
  documents: DocumentRef[]
}

type Assembled = Omit<AnalysisResults, "links">

const AI_STEP = {
  retries: { limit: 3, delay: "20 seconds", backoff: "exponential" },
  timeout: "10 minutes",
} as const

const DB_STEP = {
  retries: { limit: 5, delay: "2 seconds", backoff: "exponential" },
  timeout: "2 minutes",
} as const

/** Parallel model calls per batch; keeps us below provider rate limits. */
const LINK_CONCURRENCY = 5
/** Courses per linking call when re-linking an LTO across the programme. */
const COURSES_PER_CALL = 12

/** Errors the provider will keep returning; retrying them only burns time and money. */
function toStepError(error: unknown): Error {
  if (error instanceof LlmRequestError && !error.retryable) return new NonRetryableError(error.message)
  if (error instanceof Error) return error
  return new Error(String(error))
}

function errorMessage(error: unknown): string {
  if (error instanceof InvalidModelOutput) return `The AI returned an unusable answer: ${error.message}`
  return error instanceof Error ? error.message : String(error)
}

async function aiStep<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    throw toStepError(error)
  }
}

async function inBatches<T, R>(items: readonly T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await Promise.all(items.slice(i, i + size).map(run))))
  }
  return results
}

const textKey = (programmeId: string, sha256: string) => `p/${programmeId}/text/${sha256}.json`

type StatementRow = typeof statements.$inferSelect

function toStoredStatement(row: StatementRow): StoredStatement {
  return {
    ordinal: row.ordinal,
    documentId: row.documentId,
    kind: row.kind,
    section: row.section,
    context: row.context,
    quote: row.quote,
    page: row.page,
    verification: row.verification,
    assessedBy: row.assessedBy,
    pointerId: row.pointerId,
  }
}

export class AnalysisWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
  private get db(): Db {
    return createDb(this.env.DB)
  }

  override async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep): Promise<void> {
    const params = event.payload
    switch (params.kind) {
      case "analysis":
        return this.runAnalysis(event.instanceId, params.analysisId, step)
      case "pointer":
        return this.runPointer(params.pointerId, step)
      case "relink":
        return this.runRelink(event.instanceId, params.ltoId, params.delaySeconds, step)
    }
  }

  // ── Full analysis of one course-year ──────────────────────────────────────

  private async runAnalysis(instanceId: string, analysisId: number, step: WorkflowStep): Promise<void> {
    const context = await step.do("load", DB_STEP, () => this.loadAnalysis(analysisId, instanceId))
    if (!context) return // superseded by a newer run, or deleted

    try {
      await this.setStep(step, context, "reading documents")
      for (const doc of context.documents) {
        await step.do(`text ${doc.id}`, DB_STEP, () => this.ensureText(context.programmeId, doc))
      }

      await this.setStep(step, context, "extracting")
      const cacheKeys: Record<number, string> = {}
      for (const doc of context.documents) {
        cacheKeys[doc.id] = await step.do(`extract ${doc.id}`, AI_STEP, () =>
          aiStep(() => this.ensureExtraction(context.programmeId, doc)),
        )
      }

      await this.setStep(step, context, "verifying quotes")
      const assembled = await step.do("assemble", DB_STEP, () => this.assemble(context, cacheKeys))

      await this.setStep(step, context, "linking to LTOs")
      const ltoList = await step.do("list LTOs", DB_STEP, () => ltosForLinking(this.db, context.programmeId))
      const kinds = new Map(context.documents.map((d) => [d.id, d.kind]))
      const course: LinkingCourse = {
        key: context.analysisId,
        code: context.course.code,
        name: context.course.name,
        statements: toLinkingStatements(assembled.statements, kinds),
      }
      const linked = await inBatches(ltoList, LINK_CONCURRENCY, (lto) =>
        step.do(`link LTO ${lto.id}`, AI_STEP, () =>
          aiStep(async () => {
            const { client, linkModel } = aiConfig(this.env)
            const { links, model } = await linkLto(client, linkModel, lto, [course])
            return { ltoId: lto.id, hash: await ltoHash(lto), links, model }
          }),
        ),
      )

      const pointerIds = await step.do("list pointers", DB_STEP, async () => {
        const rows = await this.db
          .select({ id: pointers.id })
          .from(pointers)
          .where(and(eq(pointers.courseId, context.courseId), eq(pointers.year, context.year)))
        return rows.map((r) => r.id)
      })
      const judgements: Record<number, Judgement | null> = {}
      if (pointerIds.length > 0) {
        await this.setStep(step, context, "judging pointers")
        for (const pointerId of pointerIds) {
          judgements[pointerId] = await step.do(`judge ${pointerId}`, AI_STEP, () => this.judgeSafely(pointerId))
        }
      }

      await this.setStep(step, context, "saving")
      await step.do("save", DB_STEP, () => this.saveAnalysis(context, instanceId, assembled, linked, judgements))
      await step.do("notify done", DB_STEP, () => this.notify(context, true))
    } catch (error) {
      await step.do("mark failed", DB_STEP, async () => {
        await this.db
          .update(analyses)
          .set({ status: "failed", step: null, error: errorMessage(error), finishedAt: Date.now() })
          .where(and(eq(analyses.id, analysisId), eq(analyses.workflowId, instanceId)))
        await this.notify(context, false)
      })
    }
  }

  private async loadAnalysis(analysisId: number, instanceId: string): Promise<AnalysisContext | null> {
    const analysis = await this.db.select().from(analyses).where(eq(analyses.id, analysisId)).get()
    if (analysis?.workflowId !== instanceId) return null
    const course = await this.db.select().from(courses).where(eq(courses.id, analysis.courseId)).get()
    if (!course) return null
    const docs = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.courseId, analysis.courseId), eq(documents.year, analysis.year)))
      .orderBy(asc(documents.id))
    await this.db
      .update(analyses)
      .set({ status: "running", step: "reading documents", error: null })
      .where(eq(analyses.id, analysisId))
    const order: Record<DocumentKind, number> = { study_guide: 0, manual: 1, supplementary: 2 }
    return {
      analysisId,
      programmeId: analysis.programmeId,
      courseId: course.id,
      year: analysis.year,
      course: { code: course.code, name: course.name },
      documents: docs
        .sort((a, b) => order[a.kind] - order[b.kind] || a.id - b.id)
        .map((d) => ({
          id: d.id,
          kind: d.kind,
          filename: d.filename,
          mimeType: d.mimeType,
          sha256: d.sha256,
          r2Key: d.r2Key,
        })),
    }
  }

  private async setStep(step: WorkflowStep, context: AnalysisContext, name: AnalysisStep): Promise<void> {
    await step.do(`step: ${name}`, DB_STEP, async () => {
      await this.db.update(analyses).set({ step: name }).where(eq(analyses.id, context.analysisId))
      await broadcast(this.env, context.programmeId, [courseTopic(context.courseId), "courses"])
    })
  }

  private async notify(context: AnalysisContext, done: boolean): Promise<void> {
    const topics: Topic[] = [courseTopic(context.courseId), "courses"]
    if (done) topics.push("coverage", "programme")
    await broadcast(this.env, context.programmeId, topics)
  }

  private async readFile(doc: { r2Key: string; filename: string }): Promise<Uint8Array> {
    const object = await this.env.FILES.get(doc.r2Key)
    if (!object) throw new NonRetryableError(`The file ${doc.filename} is missing from storage`)
    return new Uint8Array(await object.arrayBuffer())
  }

  /** Extracted text per page, cached in R2 by content hash. */
  private async ensureText(programmeId: string, doc: DocumentRef): Promise<number> {
    const key = textKey(programmeId, doc.sha256)
    if (await this.env.FILES.head(key)) return 0
    let pages: string[]
    try {
      pages = await documentPages(await this.readFile(doc), doc.mimeType)
    } catch (error) {
      // An unreadable text layer only weakens quote verification; it should not stop the analysis.
      console.warn(`[pipeline] Could not extract text from ${doc.filename}`, error)
      pages = []
    }
    await this.env.FILES.put(key, JSON.stringify(pages), { httpMetadata: { contentType: "application/json" } })
    return pages.length
  }

  private async readPages(programmeId: string, sha256: string): Promise<string[]> {
    const object = await this.env.FILES.get(textKey(programmeId, sha256))
    if (!object) return []
    const pages: unknown = await object.json()
    return Array.isArray(pages) ? pages.filter((p): p is string => typeof p === "string") : []
  }

  /** What the model reads: PDFs natively, everything else as extracted text. */
  private async modelContent(
    programmeId: string,
    doc: { r2Key: string; filename: string; mimeType: string; sha256: string },
  ): Promise<{ type: "pdf"; data: Uint8Array } | { type: "text"; text: string }> {
    if (doc.mimeType === "application/pdf") return { type: "pdf", data: await this.readFile(doc) }
    return { type: "text", text: (await this.readPages(programmeId, doc.sha256)).join("\n\n") }
  }

  private async fields(programmeId: string): Promise<FieldDefinition[]> {
    const rows = await this.db
      .select()
      .from(extractionFields)
      .where(eq(extractionFields.programmeId, programmeId))
      .orderBy(asc(extractionFields.position))
    return rows.map((r) => ({ key: r.key, label: r.label, type: r.type, prompt: r.prompt, required: r.required }))
  }

  private fieldsFor(kind: DocumentKind, fields: FieldDefinition[]): FieldDefinition[] {
    return kind === "supplementary" ? [] : fields
  }

  /** Extract a document unless an identical extraction is cached. Returns the cache key. */
  private async ensureExtraction(programmeId: string, doc: DocumentRef): Promise<string> {
    const { client, extractModel } = aiConfig(this.env)
    const fields = this.fieldsFor(doc.kind, await this.fields(programmeId))
    const cacheKey = await sha256Hex(JSON.stringify([EXTRACTION_PROMPT_VERSION, extractModel, doc.kind, fields]))
    const cached = await this.db
      .select({ sha256: extractionCache.sha256 })
      .from(extractionCache)
      .where(and(eq(extractionCache.sha256, doc.sha256), eq(extractionCache.cacheKey, cacheKey)))
      .get()
    if (cached) return cacheKey
    const { extraction, model } = await extractDocument(client, {
      kind: doc.kind,
      filename: doc.filename,
      content: await this.modelContent(programmeId, doc),
      fields,
      model: extractModel,
    })
    await this.db
      .insert(extractionCache)
      .values({ sha256: doc.sha256, cacheKey, result: extraction, model })
      .onConflictDoNothing()
    return cacheKey
  }

  private async assemble(context: AnalysisContext, cacheKeys: Record<number, string>): Promise<Assembled> {
    const fields = await this.fields(context.programmeId)
    const extracted: ExtractedDocument[] = []
    for (const doc of context.documents) {
      const cacheKey = cacheKeys[doc.id]
      if (!cacheKey) throw new Error(`No extraction for ${doc.filename}`)
      const row = await this.db
        .select({ result: extractionCache.result })
        .from(extractionCache)
        .where(and(eq(extractionCache.sha256, doc.sha256), eq(extractionCache.cacheKey, cacheKey)))
        .get()
      const extraction = row ? parseCachedExtraction(row.result, this.fieldsFor(doc.kind, fields)) : null
      if (!extraction) throw new NonRetryableError(`The extraction of ${doc.filename} is missing or outdated; run the analysis again`)
      extracted.push({
        documentId: doc.id,
        kind: doc.kind,
        extraction,
        matcher: new DocumentMatcher(await this.readPages(context.programmeId, doc.sha256)),
      })
    }
    return assembleExtractions(extracted, fields)
  }

  private async saveAnalysis(
    context: AnalysisContext,
    instanceId: string,
    assembled: Assembled,
    linked: { ltoId: number; hash: string; links: ProposedLink[]; model: string }[],
    judgements: Record<number, Judgement | null>,
  ): Promise<void> {
    const current = await this.db
      .select({ workflowId: analyses.workflowId })
      .from(analyses)
      .where(eq(analyses.id, context.analysisId))
      .get()
    if (current?.workflowId !== instanceId) return // a newer run took over

    const kinds = new Map(context.documents.map((d) => [d.id, d.kind]))
    const byOrdinal = new Map(assembled.statements.map((s) => [s.ordinal, s]))
    const statementRows = [...assembled.statements]
    const links = buildLinks(linked.flatMap((l) => l.links), (id) => byOrdinal.get(id), kinds)

    const pointerUpdates: Parameters<typeof saveAnalysisResults>[4] = []
    const docById = new Map(context.documents.map((d) => [d.id, d]))
    const pointerList = await this.db
      .select()
      .from(pointers)
      .where(and(eq(pointers.courseId, context.courseId), eq(pointers.year, context.year)))
    for (const pointer of pointerList) {
      const judgement = judgements[pointer.id]
      const doc = docById.get(pointer.documentId)
      if (judgement === undefined || !doc) continue
      if (judgement === null) {
        pointerUpdates.push({ pointerId: pointer.id, status: "failed", verdict: "The AI could not judge this passage." })
        continue
      }
      const matcher = new DocumentMatcher(await this.readPages(context.programmeId, doc.sha256))
      const rows = pointerRows(pointer, judgement, matcher, doc.kind)
      const found = rows.statement.verification !== "unverified" || matcher.isEmpty
      statementRows.push(rows.statement)
      if (found) links.push(...rows.links)
      pointerUpdates.push({
        pointerId: pointer.id,
        status: found && judgement.supported ? "supported" : "not_supported",
        verdict: found ? judgement.verdict : "The passage could not be found in the document.",
      })
    }
    const model = linked[0]?.model ?? aiConfig(this.env).linkModel
    await saveAnalysisResults(
      this.db,
      context.analysisId,
      { ...assembled, statements: statementRows, links },
      {
        runs: linked.map((l) => ({ ltoId: l.ltoId, ltoHash: l.hash })),
        documentsHash: await documentsHashOf(context.documents.map((d) => d.sha256)),
        model: `${model} (${LINKING_PROMPT_VERSION}, ${EXTRACTION_PROMPT_VERSION})`,
      },
      pointerUpdates,
    )
  }

  // ── Re-link one LTO across the programme ──────────────────────────────────

  private async runRelink(instanceId: string, ltoId: number, delaySeconds: number, step: WorkflowStep): Promise<void> {
    if (delaySeconds > 0) await step.sleep("wait for further edits", `${delaySeconds} seconds`)
    const plan = await step.do("plan", DB_STEP, () => this.planRelink(instanceId, ltoId))
    if (!plan) return
    const results = await inBatches(plan.groups, LINK_CONCURRENCY, (analysisIds) =>
      step.do(`link ${analysisIds.join(",")}`, AI_STEP, () =>
        aiStep(async () => {
          const courseList = await this.linkingCourses(plan.programmeId, analysisIds)
          const { client, linkModel } = aiConfig(this.env)
          return (await linkLto(client, linkModel, plan.lto, courseList)).links
        }),
      ),
    )
    await step.do("save", DB_STEP, async () => {
      const lto = await this.db
        .select({ relinkWorkflowId: ltos.relinkWorkflowId })
        .from(ltos)
        .where(eq(ltos.id, ltoId))
        .get()
      if (lto?.relinkWorkflowId !== instanceId) return // edited again; the newer job takes over
      const proposed = results.flat()
      const analysisIds = plan.groups.flat()
      const rows = await inChunks(analysisIds, (chunk) =>
        this.db
          .select({ statement: statements, kind: documents.kind })
          .from(statements)
          .innerJoin(documents, eq(documents.id, statements.documentId))
          .where(inArray(statements.analysisId, chunk)),
      )
      const byId = new Map(rows.map((r) => [r.statement.id, r.statement]))
      const kinds = new Map(rows.map((r) => [r.statement.documentId, r.kind]))
      const perAnalysis = analysisIds.map((analysisId) => ({
        analysisId,
        links: buildLinks(
          proposed.filter((p) => p.courseKey === analysisId),
          (id) => {
            const row = byId.get(id)
            return row?.analysisId === analysisId ? toStoredStatement(row) : undefined
          },
          kinds,
        ),
      }))
      await saveLtoRelink(this.db, { ltoId, ltoHash: plan.hash }, perAnalysis)
      await this.db
        .update(ltos)
        .set({ relinkWorkflowId: null })
        .where(and(eq(ltos.id, ltoId), eq(ltos.relinkWorkflowId, instanceId)))
      await broadcast(this.env, plan.programmeId, ["coverage", "courses", "structure"])
    })
  }

  private async planRelink(
    instanceId: string,
    ltoId: number,
  ): Promise<{ programmeId: string; lto: LinkingLto; hash: string; groups: number[][] } | null> {
    const row = await this.db
      .select({ programmeId: ltos.programmeId, relinkWorkflowId: ltos.relinkWorkflowId })
      .from(ltos)
      .where(eq(ltos.id, ltoId))
      .get()
    if (row?.relinkWorkflowId !== instanceId) return null
    const lto = (await ltosForLinking(this.db, row.programmeId)).find((l) => l.id === ltoId)
    if (!lto) return null
    const analysisRows = await this.db
      .select({ id: analyses.id, year: analyses.year })
      .from(analyses)
      .where(and(eq(analyses.programmeId, row.programmeId), eq(analyses.hasResults, true)))
    // One call per year and at most COURSES_PER_CALL courses, to keep prompts focused.
    const byYear = new Map<string, number[]>()
    for (const a of analysisRows) byYear.set(a.year, [...(byYear.get(a.year) ?? []), a.id])
    const groups: number[][] = []
    for (const ids of byYear.values()) {
      for (let i = 0; i < ids.length; i += COURSES_PER_CALL) groups.push(ids.slice(i, i + COURSES_PER_CALL))
    }
    return { programmeId: row.programmeId, lto, hash: await ltoHash(lto), groups }
  }

  /** Statements of several analyses as linking input, identified by database id. */
  private async linkingCourses(programmeId: string, analysisIds: number[]): Promise<LinkingCourse[]> {
    const analysisRows = await this.db
      .select({ id: analyses.id, code: courses.code, name: courses.name })
      .from(analyses)
      .innerJoin(courses, eq(courses.id, analyses.courseId))
      .where(and(eq(analyses.programmeId, programmeId), inArray(analyses.id, analysisIds)))
    const rows = await this.db
      .select({ statement: statements, kind: documents.kind })
      .from(statements)
      .innerJoin(documents, eq(documents.id, statements.documentId))
      .where(inArray(statements.analysisId, analysisIds))
    const kinds = new Map(rows.map((r) => [r.statement.documentId, r.kind]))
    return analysisRows.map((a) => ({
      key: a.id,
      code: a.code,
      name: a.name,
      // Pointer passages are judged separately and never re-linked automatically.
      statements: rows
        .filter((r) => r.statement.analysisId === a.id && r.statement.pointerId === null)
        .flatMap((r) => toLinkingStatements([toStoredStatement(r.statement)], kinds, () => r.statement.id)),
    }))
  }

  // ── Pointer judgement ─────────────────────────────────────────────────────

  private async judge(pointerId: number): Promise<Judgement | null> {
    const pointer = await this.db.select().from(pointers).where(eq(pointers.id, pointerId)).get()
    if (!pointer) return null
    const doc = await this.db.select().from(documents).where(eq(documents.id, pointer.documentId)).get()
    if (!doc) return null
    const lto = (await ltosForLinking(this.db, pointer.programmeId)).find((l) => l.id === pointer.ltoId)
    if (!lto) return null
    const { client, linkModel } = aiConfig(this.env)
    const { judgement } = await judgePassage(client, linkModel, {
      lto,
      passage: pointer.passage,
      document: { filename: doc.filename, content: await this.modelContent(pointer.programmeId, doc) },
    })
    return judgement
  }

  /** A failing pointer must never fail a whole analysis; only transient errors are retried. */
  private async judgeSafely(pointerId: number): Promise<Judgement | null> {
    try {
      return await this.judge(pointerId)
    } catch (error) {
      if (error instanceof LlmRequestError && error.retryable) throw error
      console.warn(`[pipeline] Judging pointer ${pointerId} failed`, error)
      return null
    }
  }

  private async runPointer(pointerId: number, step: WorkflowStep): Promise<void> {
    const judgement = await step.do("judge", AI_STEP, () => this.judgeSafely(pointerId))
    await step.do("save", DB_STEP, async () => {
      const pointer = await this.db.select().from(pointers).where(eq(pointers.id, pointerId)).get()
      if (!pointer) return
      const analysis = await this.db
        .select({ id: analyses.id })
        .from(analyses)
        .where(and(eq(analyses.courseId, pointer.courseId), eq(analyses.year, pointer.year)))
        .get()
      const doc = await this.db.select().from(documents).where(eq(documents.id, pointer.documentId)).get()
      if (!analysis || !doc) return
      if (!judgement) {
        await savePointerResult(this.db, analysis.id, pointer.id, null, [], {
          status: "failed",
          verdict: "The AI could not judge this passage.",
        })
      } else {
        const matcher = new DocumentMatcher(await this.readPages(pointer.programmeId, doc.sha256))
        const rows = pointerRows(pointer, judgement, matcher, doc.kind)
        const found = rows.statement.verification !== "unverified" || matcher.isEmpty
        await savePointerResult(this.db, analysis.id, pointer.id, rows.statement, found ? rows.links : [], {
          status: found && judgement.supported ? "supported" : "not_supported",
          verdict: found ? judgement.verdict : "The passage could not be found in the document.",
        })
      }
      await broadcast(this.env, pointer.programmeId, [courseTopic(pointer.courseId), "courses", "coverage"])
    })
  }
}
