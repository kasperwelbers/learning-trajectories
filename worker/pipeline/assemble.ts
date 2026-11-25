import { isTestedEvidence, type DocumentKind } from "@shared/evidence"
import type { FieldDefinition } from "@shared/fields"
import type { DocumentExtraction } from "./extract"
import type { Judgement } from "./judge"
import type { LinkingStatement, ProposedLink } from "./link"
import {
  aiLinkOrdinal,
  pointerLinkOrdinal,
  pointerStatementOrdinal,
  type AnalysisResults,
  type StoredLink,
  type StoredStatement,
} from "./store"
import type { DocumentMatcher } from "./verify"

/** Pure functions that turn model output into rows to store. */

export interface ExtractedDocument {
  documentId: number
  kind: DocumentKind
  extraction: DocumentExtraction
  matcher: DocumentMatcher
}

/** The page the quote is actually found on beats the page the model reported. */
function resolvePage(matcher: DocumentMatcher, quote: string, reported: number | null): number | null {
  return matcher.pageOf(quote) ?? reported
}

/**
 * Metadata comes from the course manual. Where the manual is silent (or there is no manual yet),
 * the study guide fills in, with its source recorded so the manual health check is not fooled.
 */
function assembleFields(
  documents: readonly ExtractedDocument[],
  fields: readonly FieldDefinition[],
): AnalysisResults["fields"] {
  const sources = (["manual", "study_guide"] as const).flatMap((kind) =>
    documents.filter((d) => d.kind === kind && d.extraction.kind === kind),
  )
  const result: AnalysisResults["fields"] = []
  for (const field of fields) {
    let chosen: AnalysisResults["fields"][number] | null = null
    for (const doc of sources) {
      if (doc.extraction.kind === "supplementary") continue
      const answer = doc.extraction.fields[field.key]
      if (!answer) continue
      const hasQuote = answer.quote.trim().length > 0
      const candidate = {
        key: field.key,
        value: answer.status === "missing" ? null : answer.value,
        status: answer.status,
        quote: answer.quote,
        page: hasQuote ? resolvePage(doc.matcher, answer.quote, answer.page) : null,
        verification: hasQuote ? doc.matcher.verify(answer.quote) : ("unverified" as const),
        source: answer.status === "missing" ? null : doc.kind,
      }
      chosen ??= candidate
      if (answer.status === "found") {
        chosen = candidate
        break
      }
    }
    if (chosen) result.push(chosen)
  }
  return result
}

export function assembleExtractions(
  documents: readonly ExtractedDocument[],
  fields: readonly FieldDefinition[],
): Omit<AnalysisResults, "links"> {
  const resultFields = assembleFields(documents, fields)

  const statements: StoredStatement[] = []
  const assessments: AnalysisResults["assessments"] = []
  const rubrics: AnalysisResults["rubrics"] = []
  for (const doc of documents) {
    for (const s of doc.extraction.statements) {
      if (s.quote.trim().length === 0) continue
      statements.push({
        ordinal: statements.length + 1,
        documentId: doc.documentId,
        kind: s.kind,
        section: s.section,
        context: s.context,
        quote: s.quote,
        page: resolvePage(doc.matcher, s.quote, s.page),
        verification: doc.matcher.verify(s.quote),
        assessedBy: s.assessed_by,
        pointerId: null,
      })
    }
    for (const a of doc.extraction.assessments) {
      assessments.push({
        documentId: doc.documentId,
        name: a.name,
        weight: a.weight_percent,
        grading: a.grading,
        quote: a.quote,
        page: resolvePage(doc.matcher, a.quote, a.page),
      })
    }
    for (const r of doc.extraction.rubrics) {
      if (r.criteria.length === 0) continue
      rubrics.push({ documentId: doc.documentId, assessment: r.assessment, criteria: r.criteria, page: r.page })
    }
  }
  return { fields: resultFields, statements, assessments, rubrics }
}

/** Statements as linking input; `id` is the statement's ordinal unless `idOf` says otherwise. */
export function toLinkingStatements(
  statements: readonly StoredStatement[],
  documentKinds: ReadonlyMap<number, DocumentKind>,
  idOf: (s: StoredStatement) => number = (s) => s.ordinal,
): LinkingStatement[] {
  return statements.flatMap((s) => {
    const source = documentKinds.get(s.documentId)
    if (!source) return []
    return [
      {
        id: idOf(s),
        kind: s.kind,
        section: s.section,
        context: s.context,
        quote: s.quote,
        assessedBy: s.assessedBy,
        source,
      },
    ]
  })
}

/**
 * Stored links for one analysis. `statementFor` resolves the ids the model cited (ordinals or
 * database ids) to statements of this analysis.
 */
export function buildLinks(
  proposed: readonly ProposedLink[],
  statementFor: (id: number) => StoredStatement | undefined,
  documentKinds: ReadonlyMap<number, DocumentKind>,
): StoredLink[] {
  const perLto = new Map<number, number>()
  return proposed.flatMap((link) => {
    const cited = link.statementIds.flatMap((id) => {
      const s = statementFor(id)
      return s ? [s] : []
    })
    if (cited.length === 0) return []
    const index = perLto.get(link.ltoId) ?? 0
    perLto.set(link.ltoId, index + 1)
    const sources = [...new Set(cited.flatMap((s) => documentKinds.get(s.documentId) ?? []))]
    return [
      {
        ordinal: aiLinkOrdinal(link.ltoId, index),
        ltoId: link.ltoId,
        ref: link.ref,
        justification: link.justification,
        confidence: link.confidence,
        tested: isTestedEvidence(cited),
        origin: "ai" as const,
        sources,
        pointerId: null,
        statementOrdinals: cited.map((s) => s.ordinal),
      },
    ]
  })
}

export interface PointerInput {
  id: number
  ltoId: number
  documentId: number
  passage: string
  page: number | null
}

/** Rows for a judged pointer: the passage becomes a statement, each supported level a link. */
export function pointerRows(
  pointer: PointerInput,
  judgement: Judgement,
  matcher: DocumentMatcher,
  documentKind: DocumentKind,
): { statement: StoredStatement; links: StoredLink[] } {
  const statement: StoredStatement = {
    ordinal: pointerStatementOrdinal(pointer.id),
    documentId: pointer.documentId,
    kind: judgement.kind,
    section: judgement.section,
    context: "",
    quote: pointer.passage,
    page: matcher.pageOf(pointer.passage) ?? pointer.page,
    verification: matcher.verify(pointer.passage),
    assessedBy: [],
    pointerId: pointer.id,
  }
  const tested = isTestedEvidence([statement])
  const links: StoredLink[] = judgement.supported
    ? judgement.levels.map((level, i) => ({
        ordinal: pointerLinkOrdinal(pointer.id, i),
        ltoId: pointer.ltoId,
        ref: level.ref,
        justification: level.justification,
        confidence: level.confidence,
        tested,
        origin: "pointer",
        sources: [documentKind],
        pointerId: pointer.id,
        statementOrdinals: [statement.ordinal],
      }))
    : []
  return { statement, links }
}
