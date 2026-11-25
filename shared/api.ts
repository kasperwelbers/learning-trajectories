/**
 * The HTTP contract between worker and frontend: zod schemas for request bodies (validated by the
 * worker) and TypeScript types for responses.
 */
import { z } from "zod"
import { academicYearSchema } from "./academicYear"
import { bloomRefSchema, type BloomRef } from "./bloom"
import type { CoverageLink } from "./coverage"
import {
  type AnalysisStatus,
  type AnalysisStep,
  type DisputeStatus,
  type DocumentKind,
  type LinkOrigin,
  type PointerStatus,
  type QuoteVerification,
  type StatementKind,
  DISPUTE_STATUSES,
} from "./evidence"
import {
  FIELD_KEY_PATTERN,
  fieldTypeSchema,
  type FieldDefinition,
  type FieldStatus,
  type FieldValue,
} from "./fields"
import { roleAssignmentSchema, type ProgrammeAccess, type RoleAssignment } from "./roles"

// ── Shared building blocks ──────────────────────────────────────────────────

const name = z.string().trim().min(1).max(200)
const markdown = z.string().max(100_000)
const version = z.number().int().nonnegative()
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .or(z.literal(""))

export const yearQuerySchema = z.object({ year: academicYearSchema })

export interface ApiErrorBody {
  error: string
  code?: "conflict" | "not_found" | "forbidden" | "unauthorized" | "invalid" | "ai_unavailable"
}

// ── Auth ────────────────────────────────────────────────────────────────────

export const requestCodeBody = z.object({ email: z.email().max(254) })
export const verifyCodeBody = z.object({
  email: z.email().max(254),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
})

export interface UserDto {
  id: string
  email: string
  isServerAdmin: boolean
}

export interface MeResponse {
  user: UserDto | null
}

// ── Programmes ──────────────────────────────────────────────────────────────

export const createProgrammeBody = z.object({ name, currentYear: academicYearSchema })
/** Placeholders {code} and {year} are filled in per course, e.g. https://studiegids.vu.nl/en/courses/{year}/{code} */
const urlTemplate = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || (/^https?:\/\//.test(v) && v.includes("{code}")), "Use an http(s) URL containing {code}")

export const updateProgrammeBody = z.object({
  name: name.optional(),
  description: markdown.optional(),
  currentYear: academicYearSchema.optional(),
  studyGuideUrlTemplate: urlTemplate.optional(),
  version,
})

export interface ProgrammeSummaryDto {
  id: string
  name: string
  currentYear: string
  roles: RoleAssignment[]
}

export interface ProgrammeDto {
  id: string
  name: string
  description: string
  currentYear: string
  /** Years with at least one uploaded document, plus the current year; newest first. */
  years: string[]
  studyGuideUrlTemplate: string
  version: number
  access: ProgrammeAccess
}

// ── Members & share links ───────────────────────────────────────────────────

export const memberChangeBody = z.object({
  email: z.email().max(254),
  assignment: roleAssignmentSchema,
})

export interface MemberDto {
  userId: string
  email: string
  assignments: RoleAssignment[]
}

export const createShareLinkBody = z.object({ label: z.string().trim().max(100) })

export interface ShareLinkDto {
  token: string
  label: string
  createdAt: number
}

// ── Trajectories & LTOs ─────────────────────────────────────────────────────

export const createTrajectoryBody = z.object({ name, color: color.optional() })
export const updateTrajectoryBody = z.object({
  name: name.optional(),
  color: color.optional(),
  narrative: markdown.optional(),
  position: z.number().int().optional(),
  version,
})

export const createLtoBody = z.object({
  code: z.string().trim().min(1).max(30),
  title: z.string().trim().min(1).max(1000),
})
export const updateLtoBody = z.object({
  code: z.string().trim().min(1).max(30).optional(),
  title: z.string().trim().min(1).max(1000).optional(),
  narrative: markdown.optional(),
  position: z.number().int().optional(),
  trajectoryId: z.number().int().optional(),
  version,
})

export const importLtosBody = z.object({
  rows: z
    .array(
      z.object({
        trajectory: name,
        code: z.string().trim().min(1).max(30),
        title: z.string().trim().min(1).max(1000),
      }),
    )
    .min(1)
    .max(500),
})

export interface ImportLtosResponse {
  trajectoriesCreated: number
  ltosCreated: number
  ltosUpdated: number
}

export interface LtoDto {
  id: number
  trajectoryId: number
  code: string
  title: string
  narrative: string
  position: number
  version: number
  /** A re-link of this LTO is scheduled or running. */
  relinkPending: boolean
}

export interface TrajectoryDto {
  id: number
  name: string
  color: string
  narrative: string
  position: number
  version: number
  ltos: LtoDto[]
}

export interface StructureResponse {
  trajectories: TrajectoryDto[]
}

// ── Frameworks & justifications ─────────────────────────────────────────────

export const createFrameworkBody = z.object({ name, description: markdown.optional() })
export const updateFrameworkBody = z.object({
  name: name.optional(),
  description: markdown.optional(),
  position: z.number().int().optional(),
})
export const createIndicatorBody = z.object({
  code: z.string().trim().max(30),
  name,
  description: markdown.optional(),
})
export const updateIndicatorBody = z.object({
  code: z.string().trim().max(30).optional(),
  name: name.optional(),
  description: markdown.optional(),
  position: z.number().int().optional(),
})

export interface IndicatorDto {
  id: number
  frameworkId: number
  code: string
  name: string
  description: string
  position: number
}

export interface FrameworkDto {
  id: number
  name: string
  description: string
  position: number
  indicators: IndicatorDto[]
}

export const upsertJustificationBody = z.object({
  text: markdown,
  /** Version the client edited, or null when creating. */
  version: version.nullable(),
})

export interface JustificationDto {
  ltoId: number
  indicatorId: number
  text: string
  version: number
  updatedAt: number
  updatedBy: string | null
}

// ── Extraction fields ───────────────────────────────────────────────────────

export const createFieldBody = z.object({
  key: z.string().regex(FIELD_KEY_PATTERN, "Use lowercase letters, digits and underscores"),
  label: name,
  type: fieldTypeSchema,
  prompt: z.string().trim().min(1).max(2000),
  required: z.boolean(),
})
export const updateFieldBody = z.object({
  label: name.optional(),
  type: fieldTypeSchema.optional(),
  prompt: z.string().trim().min(1).max(2000).optional(),
  required: z.boolean().optional(),
  position: z.number().int().optional(),
})

export interface FieldDto extends FieldDefinition {
  id: number
  system: boolean
  position: number
}

// ── Courses ─────────────────────────────────────────────────────────────────

const courseCode = z.string().trim().min(1).max(40)

const programmeYear = z.number().int().min(1).max(10).nullable()

export const createCourseBody = z.object({ code: courseCode, name, programmeYear: programmeYear.optional() })
export const updateCourseBody = z.object({
  code: courseCode.optional(),
  name: name.optional(),
  programmeYear: programmeYear.optional(),
})
export const bulkCreateCoursesBody = z.object({
  courses: z
    .array(z.object({ code: courseCode, name, programmeYear: programmeYear.optional() }))
    .min(1)
    .max(300),
})

export const importPreviewBody = z.object({
  urls: z.array(z.url()).min(1).max(10),
})

export interface ProposedCourseDto {
  code: string
  name: string
  periods: number[]
  ec: number | null
  level: number | null
  /** Programme year (1, 2, 3, ...) if the source says so. */
  programmeYear: number | null
  /** Part of the curriculum the course is listed under, e.g. "Second year" or "Minor". */
  group: string
  /** Whether the source suggests this is a regular course of the programme (not a minor/elective). */
  suggested: boolean
  url: string | null
  exists: boolean
}

export interface ImportPreviewResponse {
  courses: ProposedCourseDto[]
  sources: { url: string; ok: boolean; error: string | null }[]
}

export interface ManualHealth {
  found: number
  unclear: number
  missing: number
  /** Labels of required fields that are unclear or missing. */
  requiredProblems: string[]
}

/** Course facts used by overviews and visualisations (from the effective analysis). */
export interface CourseFactsDto {
  id: number
  code: string
  name: string
  programmeYear: number | null
  /** Year of the analysis these facts come from (may be older than the selected year). */
  analysisYear: string | null
  periods: number[]
  level: number | null
  ec: number | null
}

export interface CourseSummaryDto extends CourseFactsDto {
  status: AnalysisStatus | null
  step: AnalysisStep | null
  hasManual: boolean
  hasStudyGuide: boolean
  health: ManualHealth | null
  stale: boolean
  linkCount: number
  openDisputes: number
}

export interface CoursesResponse {
  year: string
  courses: CourseSummaryDto[]
}

export interface DocumentDto {
  id: number
  year: string
  kind: DocumentKind
  filename: string
  mimeType: string
  size: number
  /** Where a fetched document (e.g. a study guide page) came from. */
  sourceUrl: string | null
  uploadedAt: number
  uploadedBy: string | null
}

export interface MetadataValueDto {
  key: string
  label: string
  required: boolean
  value: FieldValue
  status: FieldStatus
  quote: string
  page: number | null
  verification: QuoteVerification
  /** Document the value was taken from (manual preferred, study guide as fallback). */
  source: DocumentKind | null
}

export interface StatementDto {
  id: number
  documentId: number
  kind: StatementKind
  section: string
  context: string
  quote: string
  page: number | null
  verification: QuoteVerification
  /** Assessments the manual explicitly maps this statement to. */
  assessedBy: string[]
  fromPointer: boolean
}

export interface AssessmentDto {
  id: number
  documentId: number
  name: string
  weight: number | null
  grading: string
  quote: string
  page: number | null
}

export interface RubricCriterion {
  criterion: string
  description: string
  levels: { label: string; description: string }[]
}

export interface RubricDto {
  id: number
  documentId: number
  assessment: string
  criteria: RubricCriterion[]
  page: number | null
}

export type LinkDto = BloomRef & {
  id: number
  ltoId: number
  justification: string
  confidence: number
  origin: LinkOrigin
  tested: boolean
  /** Kinds of documents the cited evidence comes from. */
  sources: DocumentKind[]
  statementIds: number[]
  pointerId: number | null
  /** The LTO changed since this link was made; a re-link is pending. */
  stale: boolean
}

export interface AnalysisDto {
  id: number
  year: string
  status: AnalysisStatus
  step: AnalysisStep | null
  error: string | null
  startedAt: number | null
  finishedAt: number | null
  model: string | null
  stale: boolean
  fields: MetadataValueDto[]
  statements: StatementDto[]
  assessments: AssessmentDto[]
  rubrics: RubricDto[]
  links: LinkDto[]
}

export interface DisputeDto {
  id: number
  courseId: number
  year: string
  ltoId: number
  ref: BloomRef | null
  text: string
  status: DisputeStatus
  createdBy: string
  createdAt: number
  resolvedAt: number | null
}

export interface PointerDto {
  id: number
  courseId: number
  year: string
  ltoId: number
  documentId: number
  passage: string
  page: number | null
  note: string
  status: PointerStatus
  verdict: string
  createdBy: string
  createdAt: number
}

export interface CourseDetailResponse {
  course: { id: number; code: string; name: string; programmeYear: number | null }
  year: string
  /** Years for which this course has documents, newest first. */
  documentYears: string[]
  documents: DocumentDto[]
  analysis: AnalysisDto | null
  disputes: DisputeDto[]
  pointers: PointerDto[]
}

export const analyzeBody = z.object({ year: academicYearSchema })

export const fetchStudyGuideBody = z.object({ year: academicYearSchema, url: z.url() })

export interface FetchStudyGuidesResponse {
  fetched: number
  failed: { code: string; error: string }[]
}

export const createDisputeBody = z.object({
  year: academicYearSchema,
  ltoId: z.number().int(),
  ref: bloomRefSchema.nullable(),
  text: z.string().trim().min(1).max(5000),
})
export const updateDisputeBody = z.object({ status: z.enum(DISPUTE_STATUSES) })

export const createPointerBody = z.object({
  year: academicYearSchema,
  ltoId: z.number().int(),
  documentId: z.number().int(),
  passage: z.string().trim().min(10).max(5000),
  page: z.number().int().positive().nullable(),
  note: z.string().trim().max(2000),
})

export interface RelinkResponse {
  analysesStarted: number
  ltosRelinked: number
}

// ── Coverage & views ────────────────────────────────────────────────────────

export interface CoverageResponse {
  year: string
  courses: CourseFactsDto[]
  links: CoverageLink[]
  /** Open disputes per course × LTO, keyed `${courseId}|${ltoId}`. */
  disputedPairs: string[]
}

export interface EvidenceStatementDto {
  id: number
  kind: StatementKind
  section: string
  context: string
  quote: string
  page: number | null
  verification: QuoteVerification
  assessedBy: string[]
  document: { id: number; kind: DocumentKind; filename: string }
}

export interface EvidenceLinkDto {
  justification: string
  confidence: number
  origin: LinkOrigin
  tested: boolean
  sources: DocumentKind[]
  statements: EvidenceStatementDto[]
}

export interface LtoEvidenceResponse {
  ltoId: number
  year: string
  courses: {
    course: CourseFactsDto
    levels: (BloomRef & { tested: boolean; links: EvidenceLinkDto[] })[]
    disputes: DisputeDto[]
  }[]
}

export interface MetadataTableResponse {
  year: string
  fields: FieldDto[]
  rows: { course: CourseFactsDto; values: Partial<Record<string, MetadataValueDto>> }[]
}

export interface UploadImageResponse {
  url: string
}
