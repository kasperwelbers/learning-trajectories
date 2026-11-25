import { isTestedEvidence, type DocumentKind } from "@shared/evidence"
import type { FieldDefinition } from "@shared/fields"
import type { DocumentExtraction } from "./extract"
import type { Judgement } from "./judge"
import type { LinkingStatement, ProposedLink } from "./link"
import {
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

export function assembleExtractions(
  documents: readonly ExtractedDocument[],
  fields: readonly FieldDefinition[],
): Omit<AnalysisResults, "links"> {
  const manual = documents.find((d) => d.extraction.kind === "manual")
  const resultFields: AnalysisResults["fields"] = []
  if (manual && manual.extraction.kind === "manual") {
    for (const field of fields) {
      const answer = manual.extraction.fields[field.key]
      if (!answer) continue
      const hasQuote = answer.quote.trim().length > 0
      resultFields.push({
        key: field.key,
        value: answer.status === "missing" ? null : answer.value,
        status: answer.status,
        quote: answer.quote,
        page: hasQuote ? resolvePage(manual.matcher, answer.quote, answer.page) : null,
        verification: hasQuote ? manual.matcher.verify(answer.quote) : "unverified",
      })
    }
  }

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

export function toLinkingStatements(
  statements: readonly StoredStatement[],
  documentKinds: ReadonlyMap<number, DocumentKind>,
): LinkingStatement[] {
  return statements.map((s) => ({
    id: s.ordinal,
    kind: s.kind,
    section: s.section,
    context: s.context,
    quote: s.quote,
    assessedBy: s.assessedBy,
    source: documentKinds.get(s.documentId) === "manual" ? "manual" : "supplementary",
  }))
}

export function buildLinks(proposed: readonly ProposedLink[], statements: readonly StoredStatement[]): StoredLink[] {
  const byOrdinal = new Map(statements.map((s) => [s.ordinal, s]))
  return proposed.map((link, i) => {
    const cited = link.statementIds.flatMap((id) => {
      const s = byOrdinal.get(id)
      return s ? [s] : []
    })
    return {
      ordinal: i + 1,
      ltoId: link.ltoId,
      ref: link.ref,
      justification: link.justification,
      confidence: link.confidence,
      tested: isTestedEvidence(cited),
      origin: "ai",
      pointerId: null,
      statementOrdinals: cited.map((s) => s.ordinal),
    }
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
        pointerId: pointer.id,
        statementOrdinals: [statement.ordinal],
      }))
    : []
  return { statement, links }
}
