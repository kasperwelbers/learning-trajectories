import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { NonRetryableError } from "cloudflare:workflows"
import { and, asc, eq } from "drizzle-orm"
import type { AnalysisStep, DocumentKind } from "@shared/evidence"
import type { FieldDefinition } from "@shared/fields"
import { courseTopic, type Topic } from "@shared/topics"
import { aiConfig } from "../ai"
import { InvalidModelOutput, LlmRequestError } from "../ai/types"
import { sha256Hex } from "../auth/crypto"
import { createDb, type Db } from "../db/client"
import { analyses, courses, documents, extractionCache, extractionFields, pointers } from "../db/schema"
import { broadcast } from "../realtime/notify"
import type { WorkflowParams } from "../services/analysisRunner"
import { documentsHashOf, currentLtoHash } from "../services/hashes"
import { ltosForLinking } from "../services/linkingInput"
import { assembleExtractions, buildLinks, pointerRows, toLinkingStatements, type ExtractedDocument } from "./assemble"
import { documentPages } from "./documentText"
import { EXTRACTION_PROMPT_VERSION, extractDocument, parseCachedExtraction } from "./extract"
import { judgePassage, type Judgement } from "./judge"
import { LINKING_PROMPT_VERSION, linkStatements, type ProposedLink } from "./link"
import { saveAnalysisResults, savePointerResult } from "./store"
import { DocumentMatcher } from "./verify"

/**
 * Durable background job for the AI pipeline. Each step is retried on failure and its result is
 * persisted, so a crash halfway never repeats finished (and paid-for) model calls.
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

const AI_STEP = {
  retries: { limit: 3, delay: "20 seconds", backoff: "exponential" },
  timeout: "10 minutes",
} as const

const DB_STEP = {
  retries: { limit: 5, delay: "2 seconds", backoff: "exponential" },
  timeout: "1 minute",
} as const

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

const textKey = (programmeId: string, sha256: string) => `p/${programmeId}/text/${sha256}.json`

export class AnalysisWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
  private get db(): Db {
    return createDb(this.env.DB)
  }

  override async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep): Promise<void> {
    const params = event.payload
    if (params.kind === "analysis") await this.runAnalysis(event.instanceId, params.analysisId, step)
    else await this.runPointer(params.pointerId, step)
  }

  // ── Full analysis ─────────────────────────────────────────────────────────

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
        cacheKeys[doc.id] = await step.do(`extract ${doc.id}`, AI_STEP, async () => {
          try {
            return await this.ensureExtraction(context.programmeId, doc)
          } catch (error) {
            throw toStepError(error)
          }
        })
      }

      await this.setStep(step, context, "linking to LTOs")
      const linking = await step.do("link", AI_STEP, async () => {
        try {
          const ltos = await ltosForLinking(this.db, context.programmeId)
          const assembled = await this.assemble(context, cacheKeys)
          const kinds = new Map(context.documents.map((d) => [d.id, d.kind]))
          const { links, model } = await linkStatements(
            aiConfig(this.env).client,
            aiConfig(this.env).linkModel,
            context.course,
            ltos,
            toLinkingStatements(assembled.statements, kinds),
          )
          return { links, model, ltoHash: await currentLtoHash(this.db, context.programmeId) }
        } catch (error) {
          throw toStepError(error)
        }
      })

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
          judgements[pointerId] = await step.do(`judge ${pointerId}`, AI_STEP, async () => {
            try {
              return await this.judge(pointerId)
            } catch (error) {
              if (error instanceof LlmRequestError && error.retryable) throw error
              return null // a failing pointer must not fail the whole analysis
            }
          })
        }
      }

      await this.setStep(step, context, "saving")
      await step.do("save", DB_STEP, () => this.save(context, instanceId, cacheKeys, linking, judgements))
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
    return {
      analysisId,
      programmeId: analysis.programmeId,
      courseId: course.id,
      year: analysis.year,
      course: { code: course.code, name: course.name },
      // The manual first, so it shows up first in statement order.
      documents: docs
        .sort((a, b) => (a.kind === b.kind ? a.id - b.id : a.kind === "manual" ? -1 : 1))
        .map((d) => ({ id: d.id, kind: d.kind, filename: d.filename, mimeType: d.mimeType, sha256: d.sha256, r2Key: d.r2Key })),
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

  private async readFile(doc: DocumentRef): Promise<Uint8Array> {
    const object = await this.env.FILES.get(doc.r2Key)
    if (!object) throw new NonRetryableError(`The file ${doc.filename} is missing from storage`)
    return new Uint8Array(await object.arrayBuffer())
  }

  /** Extracted text per page, cached in R2 by content hash. */
  private async ensureText(programmeId: string, doc: DocumentRef): Promise<number> {
    const key = textKey(programmeId, doc.sha256)
    const existing = await this.env.FILES.head(key)
    if (existing) return 0
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

  private async readPages(programmeId: string, doc: DocumentRef): Promise<string[]> {
    const object = await this.env.FILES.get(textKey(programmeId, doc.sha256))
    if (!object) return []
    const pages: unknown = await object.json()
    return Array.isArray(pages) ? pages.filter((p): p is string => typeof p === "string") : []
  }

  private async fields(programmeId: string): Promise<FieldDefinition[]> {
    const rows = await this.db
      .select()
      .from(extractionFields)
      .where(eq(extractionFields.programmeId, programmeId))
      .orderBy(asc(extractionFields.position))
    return rows.map((r) => ({ key: r.key, label: r.label, type: r.type, prompt: r.prompt, required: r.required }))
  }

  /** Extract a document unless an identical extraction is cached. Returns the cache key. */
  private async ensureExtraction(programmeId: string, doc: DocumentRef): Promise<string> {
    const { client, extractModel } = aiConfig(this.env)
    const fields = doc.kind === "manual" ? await this.fields(programmeId) : []
    const cacheKey = await sha256Hex(
      JSON.stringify([EXTRACTION_PROMPT_VERSION, extractModel, doc.kind, fields]),
    )
    const cached = await this.db
      .select({ sha256: extractionCache.sha256 })
      .from(extractionCache)
      .where(and(eq(extractionCache.sha256, doc.sha256), eq(extractionCache.cacheKey, cacheKey)))
      .get()
    if (cached) return cacheKey

    const content =
      doc.mimeType === "application/pdf"
        ? { type: "pdf" as const, data: await this.readFile(doc) }
        : { type: "text" as const, text: (await this.readPages(programmeId, doc)).join("\n\n") }
    const { extraction, model } = await extractDocument(client, {
      kind: doc.kind,
      filename: doc.filename,
      content,
      fields,
      model: extractModel,
    })
    await this.db
      .insert(extractionCache)
      .values({ sha256: doc.sha256, cacheKey, result: extraction, model })
      .onConflictDoNothing()
    return cacheKey
  }

  private async assemble(context: AnalysisContext, cacheKeys: Record<number, string>) {
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
      const extraction = row ? parseCachedExtraction(row.result, doc.kind === "manual" ? fields : []) : null
      if (!extraction) throw new Error(`The extraction of ${doc.filename} is missing or outdated; run the analysis again`)
      extracted.push({
        documentId: doc.id,
        kind: doc.kind,
        extraction,
        matcher: new DocumentMatcher(await this.readPages(context.programmeId, doc)),
      })
    }
    return assembleExtractions(extracted, fields)
  }

  private async save(
    context: AnalysisContext,
    instanceId: string,
    cacheKeys: Record<number, string>,
    linking: { links: ProposedLink[]; model: string; ltoHash: string },
    judgements: Record<number, Judgement | null>,
  ): Promise<void> {
    const current = await this.db
      .select({ workflowId: analyses.workflowId })
      .from(analyses)
      .where(eq(analyses.id, context.analysisId))
      .get()
    if (current?.workflowId !== instanceId) return // a newer run took over

    const assembled = await this.assemble(context, cacheKeys)
    const links = buildLinks(linking.links, assembled.statements)
    const pointerUpdates: Parameters<typeof saveAnalysisResults>[4] = []
    const docById = new Map(context.documents.map((d) => [d.id, d]))
    const pointerRowsList = await this.db
      .select()
      .from(pointers)
      .where(and(eq(pointers.courseId, context.courseId), eq(pointers.year, context.year)))
    for (const pointer of pointerRowsList) {
      const judgement = judgements[pointer.id]
      const doc = docById.get(pointer.documentId)
      if (judgement === undefined || !doc) continue
      if (judgement === null) {
        pointerUpdates.push({ pointerId: pointer.id, status: "failed", verdict: "The AI could not judge this passage." })
        continue
      }
      const matcher = new DocumentMatcher(await this.readPages(context.programmeId, doc))
      const rows = pointerRows(pointer, judgement, matcher)
      const found = rows.statement.verification !== "unverified" || matcher.isEmpty
      assembled.statements.push(rows.statement)
      if (found) links.push(...rows.links)
      pointerUpdates.push({
        pointerId: pointer.id,
        status: found && judgement.supported ? "supported" : "not_supported",
        verdict: found ? judgement.verdict : "The passage could not be found in the document.",
      })
    }
    await saveAnalysisResults(
      this.db,
      context.analysisId,
      { ...assembled, links },
      {
        ltoHash: linking.ltoHash,
        documentsHash: await documentsHashOf(context.documents.map((d) => d.sha256)),
        model: `${linking.model} (${LINKING_PROMPT_VERSION}, ${EXTRACTION_PROMPT_VERSION})`,
      },
      pointerUpdates,
    )
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
    const content =
      doc.mimeType === "application/pdf"
        ? { type: "pdf" as const, data: await this.readFile(doc) }
        : { type: "text" as const, text: (await this.readPages(pointer.programmeId, doc)).join("\n\n") }
    const { judgement } = await judgePassage(client, linkModel, {
      lto,
      passage: pointer.passage,
      document: { filename: doc.filename, content },
    })
    return judgement
  }

  private async runPointer(pointerId: number, step: WorkflowStep): Promise<void> {
    const judgement = await step.do("judge", AI_STEP, async () => {
      try {
        return await this.judge(pointerId)
      } catch (error) {
        if (error instanceof LlmRequestError && error.retryable) throw error
        return null
      }
    })
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
        const matcher = new DocumentMatcher(
          await this.readPages(pointer.programmeId, { ...doc, kind: doc.kind }),
        )
        const rows = pointerRows(pointer, judgement, matcher)
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
