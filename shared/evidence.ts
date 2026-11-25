import { z } from "zod"

/** Where a learning statement comes from in a course document. */
export const STATEMENT_KINDS = ["learning_goal", "activity", "assessment"] as const
export type StatementKind = (typeof STATEMENT_KINDS)[number]
export const statementKindSchema = z.enum(STATEMENT_KINDS)

export const STATEMENT_KIND_LABELS: Record<StatementKind, string> = {
  learning_goal: "Learning goal",
  activity: "Learning activity",
  assessment: "Assessment",
}

/** Who established a link: the AI on its own, or the AI judging a passage a coordinator pointed at. */
export const LINK_ORIGINS = ["ai", "pointer"] as const
export type LinkOrigin = (typeof LINK_ORIGINS)[number]

/**
 * - study_guide: the public course description (e.g. the online study guide), usually fetched by URL
 * - manual: the course manual, the source of truth for metadata and the manual health check
 * - supplementary: other course material (rubrics, assignment instructions)
 */
export const DOCUMENT_KINDS = ["study_guide", "manual", "supplementary"] as const
export type DocumentKind = (typeof DOCUMENT_KINDS)[number]
export const documentKindSchema = z.enum(DOCUMENT_KINDS)

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  study_guide: "Study guide",
  manual: "Course manual",
  supplementary: "Supplementary material",
}

export const QUOTE_VERIFICATIONS = ["verified", "approximate", "unverified"] as const
export type QuoteVerification = (typeof QUOTE_VERIFICATIONS)[number]

export const ANALYSIS_STATUSES = ["queued", "running", "done", "failed"] as const
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number]

export const ANALYSIS_STEPS = [
  "reading documents",
  "extracting",
  "verifying quotes",
  "linking to LTOs",
  "judging pointers",
  "saving",
] as const
export type AnalysisStep = (typeof ANALYSIS_STEPS)[number]

export const POINTER_STATUSES = ["pending", "supported", "not_supported", "failed"] as const
export type PointerStatus = (typeof POINTER_STATUSES)[number]

export const DISPUTE_STATUSES = ["open", "resolved"] as const
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number]

/**
 * A level is tested when the evidence contains an assessment statement, or a learning goal that
 * the manual explicitly maps to an assessment.
 */
export function isTestedEvidence(
  statements: readonly { kind: StatementKind; assessedBy: readonly string[] }[],
): boolean {
  return statements.some((s) => s.kind === "assessment" || s.assessedBy.length > 0)
}
