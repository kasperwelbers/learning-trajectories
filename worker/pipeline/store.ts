import { and, eq, inArray, sql } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import type { BloomRef } from "@shared/bloom"
import type { DocumentKind, LinkOrigin, QuoteVerification, StatementKind } from "@shared/evidence"
import type { FieldStatus, FieldValue } from "@shared/fields"
import type { RubricCriterion } from "@shared/api"
import type { Db } from "../db/client"
import {
  analyses,
  analysisFields,
  assessments,
  linkRuns,
  linkStatements,
  links,
  pointers,
  rubrics,
  statements,
} from "../db/schema"

/**
 * Persists pipeline results. Everything for one analysis is written in a single D1 batch
 * (one transaction), so viewers never see half-updated results. Links reference statements
 * through their per-analysis ordinals, which lets one batch insert both.
 */

export interface StoredField {
  key: string
  value: FieldValue
  status: FieldStatus
  quote: string
  page: number | null
  verification: QuoteVerification
  source: DocumentKind | null
}

export interface StoredStatement {
  ordinal: number
  documentId: number
  kind: StatementKind
  section: string
  context: string
  quote: string
  page: number | null
  verification: QuoteVerification
  assessedBy: string[]
  pointerId: number | null
}

export interface StoredAssessment {
  documentId: number
  name: string
  weight: number | null
  grading: string
  quote: string
  page: number | null
}

export interface StoredRubric {
  documentId: number
  assessment: string
  criteria: RubricCriterion[]
  page: number | null
}

export interface StoredLink {
  ordinal: number
  ltoId: number
  ref: BloomRef
  justification: string
  confidence: number
  tested: boolean
  origin: LinkOrigin
  sources: DocumentKind[]
  pointerId: number | null
  statementOrdinals: number[]
}

export interface AnalysisResults {
  fields: StoredField[]
  statements: StoredStatement[]
  assessments: StoredAssessment[]
  rubrics: StoredRubric[]
  links: StoredLink[]
}

/**
 * Link ordinals encode the LTO, so the links of one LTO can be replaced on their own.
 * Ordinals of pointer-derived rows live far above those of extracted rows.
 */
export const aiLinkOrdinal = (ltoId: number, index: number) => ltoId * 1000 + index
const POINTER_ORDINAL_BASE = 1_000_000_000
export const pointerStatementOrdinal = (pointerId: number) => POINTER_ORDINAL_BASE + pointerId
export const pointerLinkOrdinal = (pointerId: number, index: number) =>
  POINTER_ORDINAL_BASE + pointerId * 32 + index

/** D1 allows at most 100 bound parameters per statement. */
const MAX_PARAMS = 100

function chunk<T>(rows: readonly T[], columns: number): T[][] {
  const size = Math.max(1, Math.floor(MAX_PARAMS / columns))
  const chunks: T[][] = []
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size))
  return chunks
}

type Batch = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]

function insertStatements(
  db: Db,
  analysisId: number,
  rows: readonly StoredStatement[],
): BatchItem<"sqlite">[] {
  return chunk(rows, 12).map((part) =>
    db.insert(statements).values(part.map((s) => ({ ...s, analysisId }))),
  )
}

function insertLinks(
  db: Db,
  analysisId: number,
  rows: readonly StoredLink[],
): BatchItem<"sqlite">[] {
  const items: BatchItem<"sqlite">[] = chunk(rows, 12).map((part) =>
    db.insert(links).values(
      part.map((l) => ({
        analysisId,
        ordinal: l.ordinal,
        ltoId: l.ltoId,
        domain: l.ref.domain,
        level: l.ref.level,
        justification: l.justification,
        confidence: l.confidence,
        tested: l.tested,
        origin: l.origin,
        sources: l.sources,
        pointerId: l.pointerId,
      })),
    ),
  )
  for (const link of rows) {
    for (const ordinals of chunk(link.statementOrdinals, 1)) {
      if (ordinals.length === 0) continue
      items.push(
        db.insert(linkStatements).select(
          db
            .select({ linkId: links.id, statementId: statements.id })
            .from(links)
            .innerJoin(statements, eq(statements.analysisId, links.analysisId))
            .where(
              and(
                eq(links.analysisId, analysisId),
                eq(links.ordinal, link.ordinal),
                inArray(statements.ordinal, ordinals),
              ),
            ),
        ),
      )
    }
  }
  return items
}

interface LinkRun {
  ltoId: number
  ltoHash: string
}

function upsertLinkRuns(
  db: Db,
  analysisId: number,
  runs: readonly LinkRun[],
): BatchItem<"sqlite">[] {
  const linkedAt = Date.now()
  return chunk(runs, 4).map((part) =>
    db
      .insert(linkRuns)
      .values(
        part.map((r) => ({
          analysisId,
          ltoId: r.ltoId,
          ltoHash: r.ltoHash,
          linkedAt,
        })),
      )
      .onConflictDoUpdate({
        target: [linkRuns.analysisId, linkRuns.ltoId],
        set: {
          ltoHash: sql`excluded.lto_hash`,
          linkedAt: sql`excluded.linked_at`,
        },
      }),
  )
}

export async function saveAnalysisResults(
  db: Db,
  analysisId: number,
  results: AnalysisResults,
  meta: { runs: LinkRun[]; documentsHash: string; model: string },
  pointerUpdates: {
    pointerId: number
    status: "supported" | "not_supported" | "failed"
    verdict: string
  }[],
): Promise<void> {
  const batch: Batch = [
    db.delete(analysisFields).where(eq(analysisFields.analysisId, analysisId)),
    db.delete(links).where(eq(links.analysisId, analysisId)),
    db.delete(statements).where(eq(statements.analysisId, analysisId)),
    db.delete(assessments).where(eq(assessments.analysisId, analysisId)),
    db.delete(rubrics).where(eq(rubrics.analysisId, analysisId)),
    db.delete(linkRuns).where(eq(linkRuns.analysisId, analysisId)),
    ...chunk(results.fields, 7).map((part) =>
      db.insert(analysisFields).values(part.map((f) => ({ ...f, analysisId }))),
    ),
    ...insertStatements(db, analysisId, results.statements),
    ...chunk(results.assessments, 7).map((part) =>
      db.insert(assessments).values(part.map((a) => ({ ...a, analysisId }))),
    ),
    ...chunk(results.rubrics, 5).map((part) =>
      db.insert(rubrics).values(part.map((r) => ({ ...r, analysisId }))),
    ),
    ...insertLinks(db, analysisId, results.links),
    ...upsertLinkRuns(db, analysisId, meta.runs),
    ...pointerUpdates.map((p) =>
      db
        .update(pointers)
        .set({ status: p.status, verdict: p.verdict })
        .where(eq(pointers.id, p.pointerId)),
    ),
    db
      .update(analyses)
      .set({
        status: "done",
        step: null,
        error: null,
        hasResults: true,
        finishedAt: Date.now(),
        documentsHash: meta.documentsHash,
        model: meta.model,
      })
      .where(eq(analyses.id, analysisId)),
  ]
  await db.batch(batch)
}

/** Replace the AI links of one LTO in several analyses (after the LTO was edited). */
export async function saveLtoRelink(
  db: Db,
  run: LinkRun,
  perAnalysis: readonly { analysisId: number; links: StoredLink[] }[],
): Promise<void> {
  const items: BatchItem<"sqlite">[] = perAnalysis.flatMap(({ analysisId, links: rows }) => [
    db
      .delete(links)
      .where(
        and(eq(links.analysisId, analysisId), eq(links.ltoId, run.ltoId), eq(links.origin, "ai")),
      ),
    ...insertLinks(db, analysisId, rows),
    ...upsertLinkRuns(db, analysisId, [run]),
  ])
  const [first, ...rest] = items
  if (first) await db.batch([first, ...rest])
}

/** Replace the links and statement created from one pointer. */
export async function savePointerResult(
  db: Db,
  analysisId: number,
  pointerId: number,
  statement: StoredStatement | null,
  pointerLinks: StoredLink[],
  update: { status: "supported" | "not_supported" | "failed"; verdict: string },
): Promise<void> {
  const batch: Batch = [
    db.delete(links).where(and(eq(links.analysisId, analysisId), eq(links.pointerId, pointerId))),
    db
      .delete(statements)
      .where(and(eq(statements.analysisId, analysisId), eq(statements.pointerId, pointerId))),
    ...(statement ? insertStatements(db, analysisId, [statement]) : []),
    ...insertLinks(db, analysisId, pointerLinks),
    db.update(pointers).set(update).where(eq(pointers.id, pointerId)),
  ]
  await db.batch(batch)
}
