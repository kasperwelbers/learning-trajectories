import { eq, inArray } from "drizzle-orm"
import type {
  AnalysisDto,
  AssessmentDto,
  FieldDto,
  LinkDto,
  MetadataValueDto,
  RubricDto,
  StatementDto,
} from "@shared/api"
import { parseBloomRef } from "@shared/bloom"
import type { Db } from "../db/client"
import { inChunks } from "../db/batching"
import {
  analysisFields,
  assessments,
  links,
  linkStatements,
  rubrics,
  statements,
} from "../db/schema"
import type { AnalysisRow } from "./courseFacts"
import type { Staleness } from "./staleness"

type LinkRow = typeof links.$inferSelect
type StatementRow = typeof statements.$inferSelect

function toStatementDto(row: StatementRow): StatementDto {
  return {
    id: row.id,
    documentId: row.documentId,
    kind: row.kind,
    section: row.section,
    context: row.context,
    quote: row.quote,
    page: row.page,
    verification: row.verification,
    assessedBy: row.assessedBy,
    fromPointer: row.pointerId !== null,
  }
}

/**
 * Links with their evidence statement ids; links with an invalid Bloom ref are dropped.
 * `isStale` tells whether the link's LTO changed since it was linked for that analysis.
 */
export async function loadLinkDtos(
  db: Db,
  linkRows: readonly LinkRow[],
  isStale: (analysisId: number, ltoId: number) => boolean = () => false,
): Promise<LinkDto[]> {
  const evidence = await inChunks(
    linkRows.map((l) => l.id),
    (chunk) => db.select().from(linkStatements).where(inArray(linkStatements.linkId, chunk)),
  )
  const byLink = new Map<number, number[]>()
  for (const e of evidence) byLink.set(e.linkId, [...(byLink.get(e.linkId) ?? []), e.statementId])
  return linkRows.flatMap((row) => {
    const ref = parseBloomRef(row.domain, row.level)
    if (!ref) return []
    return [
      {
        ...ref,
        id: row.id,
        ltoId: row.ltoId,
        justification: row.justification,
        confidence: row.confidence,
        origin: row.origin,
        tested: row.tested,
        sources: row.sources,
        statementIds: byLink.get(row.id) ?? [],
        pointerId: row.pointerId,
        stale: row.origin === "ai" && isStale(row.analysisId, row.ltoId),
      },
    ]
  })
}

export function metadataValues(
  fields: readonly FieldDto[],
  rows: readonly (typeof analysisFields.$inferSelect)[],
): MetadataValueDto[] {
  const byKey = new Map(rows.map((r) => [r.key, r]))
  return fields.map((field) => {
    const row = byKey.get(field.key)
    return {
      key: field.key,
      label: field.label,
      required: field.required,
      value: row?.value ?? null,
      // A field added after the analysis ran has not been extracted yet.
      status: row?.status ?? "missing",
      quote: row?.quote ?? "",
      page: row?.page ?? null,
      verification: row?.verification ?? "unverified",
      source: row?.source ?? null,
    }
  })
}

export async function loadAnalysisDto(
  db: Db,
  analysis: AnalysisRow,
  fields: readonly FieldDto[],
  staleness: Staleness,
): Promise<AnalysisDto> {
  const staleLtos = new Set(staleness.staleLtos(analysis))
  const [fieldRows, statementRows, assessmentRows, rubricRows, linkRows] = await Promise.all([
    db.select().from(analysisFields).where(eq(analysisFields.analysisId, analysis.id)),
    db.select().from(statements).where(eq(statements.analysisId, analysis.id)),
    db.select().from(assessments).where(eq(assessments.analysisId, analysis.id)),
    db.select().from(rubrics).where(eq(rubrics.analysisId, analysis.id)),
    db.select().from(links).where(eq(links.analysisId, analysis.id)),
  ])
  const assessmentDtos: AssessmentDto[] = assessmentRows.map((a) => ({
    id: a.id,
    documentId: a.documentId,
    name: a.name,
    weight: a.weight,
    grading: a.grading,
    quote: a.quote,
    page: a.page,
  }))
  const rubricDtos: RubricDto[] = rubricRows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    assessment: r.assessment,
    criteria: r.criteria,
    page: r.page,
  }))
  return {
    id: analysis.id,
    year: analysis.year,
    status: analysis.status,
    step: analysis.step,
    error: analysis.error,
    startedAt: analysis.startedAt,
    finishedAt: analysis.finishedAt,
    model: analysis.model,
    stale: staleness.isStale(analysis),
    fields: metadataValues(fields, fieldRows),
    statements: statementRows.map(toStatementDto),
    assessments: assessmentDtos,
    rubrics: rubricDtos,
    links: await loadLinkDtos(db, linkRows, (_analysisId, ltoId) => staleLtos.has(ltoId)),
  }
}
