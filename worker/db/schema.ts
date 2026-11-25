import { sql } from "drizzle-orm"
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
import type { RubricCriterion } from "@shared/api"
import type { BloomDomain } from "@shared/bloom"
import type {
  AnalysisStatus,
  AnalysisStep,
  DisputeStatus,
  DocumentKind,
  LinkOrigin,
  PointerStatus,
  QuoteVerification,
  StatementKind,
} from "@shared/evidence"
import type { FieldStatus, FieldType, FieldValue } from "@shared/fields"
import type { Role } from "@shared/roles"

const now = sql`(unixepoch() * 1000)`
const createdAt = () => integer("created_at").notNull().default(now)

// ── Accounts ────────────────────────────────────────────────────────────────

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  isServerAdmin: integer("is_server_admin", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
})

export const otpCodes = sqliteTable("otp_codes", {
  email: text("email").primaryKey(),
  codeHash: text("code_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: createdAt(),
})

export const sessions = sqliteTable(
  "sessions",
  {
    /** SHA-256 of the session token; the token itself only lives in the cookie. */
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
)

// ── Programmes & access ─────────────────────────────────────────────────────

export const programmes = sqliteTable("programmes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  currentYear: text("current_year").notNull(),
  studyGuideUrlTemplate: text("study_guide_url_template").notNull().default(""),
  version: integer("version").notNull().default(0),
  createdAt: createdAt(),
})

export const programmeRoles = sqliteTable(
  "programme_roles",
  {
    programmeId: text("programme_id")
      .notNull()
      .references(() => programmes.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<Role>().notNull(),
    /** Trajectory id or course id for scoped roles; 0 for programme admins. */
    scopeId: integer("scope_id").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.programmeId, t.userId, t.role, t.scopeId] }),
    index("programme_roles_user_idx").on(t.userId),
  ],
)

export const shareLinks = sqliteTable("share_links", {
  token: text("token").primaryKey(),
  programmeId: text("programme_id")
    .notNull()
    .references(() => programmes.id, { onDelete: "cascade" }),
  label: text("label").notNull().default(""),
  createdBy: text("created_by"),
  createdAt: createdAt(),
})

// ── Trajectories, LTOs, frameworks ──────────────────────────────────────────

export const trajectories = sqliteTable(
  "trajectories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    programmeId: text("programme_id")
      .notNull()
      .references(() => programmes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default(""),
    narrative: text("narrative").notNull().default(""),
    position: integer("position").notNull().default(0),
    version: integer("version").notNull().default(0),
  },
  (t) => [uniqueIndex("trajectories_programme_name_idx").on(t.programmeId, t.name)],
)

export const ltos = sqliteTable(
  "ltos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    programmeId: text("programme_id")
      .notNull()
      .references(() => programmes.id, { onDelete: "cascade" }),
    trajectoryId: integer("trajectory_id")
      .notNull()
      .references(() => trajectories.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    narrative: text("narrative").notNull().default(""),
    position: integer("position").notNull().default(0),
    version: integer("version").notNull().default(0),
    /** Instance id of the debounced re-link workflow started by the latest edit. */
    relinkWorkflowId: text("relink_workflow_id"),
  },
  (t) => [
    uniqueIndex("ltos_programme_code_idx").on(t.programmeId, t.code),
    index("ltos_trajectory_idx").on(t.trajectoryId),
  ],
)

export const frameworks = sqliteTable("frameworks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  programmeId: text("programme_id")
    .notNull()
    .references(() => programmes.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  position: integer("position").notNull().default(0),
})

export const indicators = sqliteTable("indicators", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  programmeId: text("programme_id")
    .notNull()
    .references(() => programmes.id, { onDelete: "cascade" }),
  frameworkId: integer("framework_id")
    .notNull()
    .references(() => frameworks.id, { onDelete: "cascade" }),
  code: text("code").notNull().default(""),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  position: integer("position").notNull().default(0),
})

export const justifications = sqliteTable(
  "justifications",
  {
    ltoId: integer("lto_id")
      .notNull()
      .references(() => ltos.id, { onDelete: "cascade" }),
    indicatorId: integer("indicator_id")
      .notNull()
      .references(() => indicators.id, { onDelete: "cascade" }),
    programmeId: text("programme_id")
      .notNull()
      .references(() => programmes.id, { onDelete: "cascade" }),
    text: text("text").notNull().default(""),
    version: integer("version").notNull().default(0),
    updatedAt: integer("updated_at").notNull().default(now),
    updatedBy: text("updated_by"),
  },
  (t) => [primaryKey({ columns: [t.ltoId, t.indicatorId] })],
)

// ── Extraction configuration ────────────────────────────────────────────────

export const extractionFields = sqliteTable(
  "extraction_fields",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    programmeId: text("programme_id")
      .notNull()
      .references(() => programmes.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: text("type", { mode: "json" }).$type<FieldType>().notNull(),
    prompt: text("prompt").notNull(),
    required: integer("required", { mode: "boolean" }).notNull().default(false),
    system: integer("system", { mode: "boolean" }).notNull().default(false),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("extraction_fields_programme_key_idx").on(t.programmeId, t.key)],
)

// ── Courses & documents ─────────────────────────────────────────────────────

export const courses = sqliteTable(
  "courses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    programmeId: text("programme_id")
      .notNull()
      .references(() => programmes.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** Year of the programme in which students take the course (1, 2, 3, ...), if known. */
    programmeYear: integer("programme_year"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("courses_programme_code_idx").on(t.programmeId, t.code)],
)

export const documents = sqliteTable(
  "documents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    programmeId: text("programme_id")
      .notNull()
      .references(() => programmes.id, { onDelete: "cascade" }),
    courseId: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    year: text("year").notNull(),
    kind: text("kind").$type<DocumentKind>().notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    r2Key: text("r2_key").notNull(),
    sourceUrl: text("source_url"),
    uploadedBy: text("uploaded_by"),
    uploadedAt: integer("uploaded_at").notNull().default(now),
  },
  (t) => [index("documents_course_year_idx").on(t.courseId, t.year)],
)

/** Extraction results per document content, so unchanged documents are never re-extracted. */
export const extractionCache = sqliteTable(
  "extraction_cache",
  {
    sha256: text("sha256").notNull(),
    /** Hash of everything else that influences the result: prompt version, schema, model. */
    cacheKey: text("cache_key").notNull(),
    result: text("result", { mode: "json" }).$type<unknown>().notNull(),
    model: text("model").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.sha256, t.cacheKey] })],
)

// ── Analyses ────────────────────────────────────────────────────────────────

export const analyses = sqliteTable(
  "analyses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    programmeId: text("programme_id")
      .notNull()
      .references(() => programmes.id, { onDelete: "cascade" }),
    courseId: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    year: text("year").notNull(),
    status: text("status").$type<AnalysisStatus>().notNull(),
    step: text("step").$type<AnalysisStep>(),
    error: text("error"),
    workflowId: text("workflow_id"),
    model: text("model"),
    /** Hash of the documents the results were extracted from (for staleness). */
    documentsHash: text("documents_hash"),
    /** Whether the stored results are complete (false until the first successful run). */
    hasResults: integer("has_results", { mode: "boolean" }).notNull().default(false),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("analyses_course_year_idx").on(t.courseId, t.year)],
)

export const analysisFields = sqliteTable(
  "analysis_fields",
  {
    analysisId: integer("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value", { mode: "json" }).$type<FieldValue>(),
    status: text("status").$type<FieldStatus>().notNull(),
    quote: text("quote").notNull().default(""),
    page: integer("page"),
    verification: text("verification").$type<QuoteVerification>().notNull(),
    source: text("source").$type<DocumentKind>(),
  },
  (t) => [primaryKey({ columns: [t.analysisId, t.key] })],
)

export const statements = sqliteTable(
  "statements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    analysisId: integer("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    documentId: integer("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** Position within the analysis; lets one batch insert links that reference statements. */
    ordinal: integer("ordinal").notNull(),
    kind: text("kind").$type<StatementKind>().notNull(),
    section: text("section").notNull().default(""),
    /** Sentence stem the quote continues, e.g. "The student is able to:". */
    context: text("context").notNull().default(""),
    quote: text("quote").notNull(),
    page: integer("page"),
    verification: text("verification").$type<QuoteVerification>().notNull(),
    assessedBy: text("assessed_by", { mode: "json" }).$type<string[]>().notNull(),
    pointerId: integer("pointer_id").references(() => pointers.id, {
      onDelete: "cascade",
    }),
  },
  (t) => [uniqueIndex("statements_analysis_ordinal_idx").on(t.analysisId, t.ordinal)],
)

export const assessments = sqliteTable("assessments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  analysisId: integer("analysis_id")
    .notNull()
    .references(() => analyses.id, { onDelete: "cascade" }),
  documentId: integer("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  weight: real("weight"),
  grading: text("grading").notNull().default(""),
  quote: text("quote").notNull().default(""),
  page: integer("page"),
})

export const rubrics = sqliteTable("rubrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  analysisId: integer("analysis_id")
    .notNull()
    .references(() => analyses.id, { onDelete: "cascade" }),
  documentId: integer("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  assessment: text("assessment").notNull(),
  criteria: text("criteria", { mode: "json" }).$type<RubricCriterion[]>().notNull(),
  page: integer("page"),
})

export const links = sqliteTable(
  "links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    analysisId: integer("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    ltoId: integer("lto_id")
      .notNull()
      .references(() => ltos.id, { onDelete: "cascade" }),
    domain: text("domain").$type<BloomDomain>().notNull(),
    level: text("level").notNull(),
    justification: text("justification").notNull(),
    confidence: real("confidence").notNull(),
    tested: integer("tested", { mode: "boolean" }).notNull(),
    origin: text("origin").$type<LinkOrigin>().notNull(),
    sources: text("sources", { mode: "json" }).$type<DocumentKind[]>().notNull(),
    pointerId: integer("pointer_id").references(() => pointers.id, {
      onDelete: "cascade",
    }),
  },
  (t) => [
    uniqueIndex("links_analysis_ordinal_idx").on(t.analysisId, t.ordinal),
    index("links_lto_idx").on(t.ltoId),
  ],
)

/**
 * When each LTO was last linked for an analysis, and against which version of the LTO.
 * An LTO edit only makes its own links stale, and only that LTO is re-linked.
 */
export const linkRuns = sqliteTable(
  "link_runs",
  {
    analysisId: integer("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    ltoId: integer("lto_id")
      .notNull()
      .references(() => ltos.id, { onDelete: "cascade" }),
    ltoHash: text("lto_hash").notNull(),
    linkedAt: integer("linked_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.analysisId, t.ltoId] })],
)

export const linkStatements = sqliteTable(
  "link_statements",
  {
    linkId: integer("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    statementId: integer("statement_id")
      .notNull()
      .references(() => statements.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.linkId, t.statementId] })],
)

// ── Coordinator feedback ────────────────────────────────────────────────────

export const disputes = sqliteTable(
  "disputes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    programmeId: text("programme_id")
      .notNull()
      .references(() => programmes.id, { onDelete: "cascade" }),
    courseId: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    year: text("year").notNull(),
    ltoId: integer("lto_id")
      .notNull()
      .references(() => ltos.id, { onDelete: "cascade" }),
    /** Null domain/level: the dispute is about the LTO link as a whole. */
    domain: text("domain").$type<BloomDomain>(),
    level: text("level"),
    text: text("text").notNull(),
    status: text("status").$type<DisputeStatus>().notNull().default("open"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    resolvedAt: integer("resolved_at"),
  },
  (t) => [index("disputes_course_idx").on(t.courseId)],
)

export const pointers = sqliteTable(
  "pointers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    programmeId: text("programme_id")
      .notNull()
      .references(() => programmes.id, { onDelete: "cascade" }),
    courseId: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    year: text("year").notNull(),
    ltoId: integer("lto_id")
      .notNull()
      .references(() => ltos.id, { onDelete: "cascade" }),
    documentId: integer("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    passage: text("passage").notNull(),
    page: integer("page"),
    note: text("note").notNull().default(""),
    status: text("status").$type<PointerStatus>().notNull().default("pending"),
    verdict: text("verdict").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("pointers_course_year_idx").on(t.courseId, t.year)],
)

// ── Uploaded images (narratives) ────────────────────────────────────────────

export const images = sqliteTable("images", {
  key: text("key").primaryKey(),
  programmeId: text("programme_id")
    .notNull()
    .references(() => programmes.id, { onDelete: "cascade" }),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  uploadedBy: text("uploaded_by"),
  createdAt: createdAt(),
})
