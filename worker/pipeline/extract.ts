import { z } from "zod"
import { DOCUMENT_KIND_LABELS, STATEMENT_KINDS, type DocumentKind } from "@shared/evidence"
import { describeFieldType, fieldsObjectSchema, type FieldDefinition } from "@shared/fields"
import type { ContentPart, LlmClient } from "../ai/types"

/**
 * Step 1 of the pipeline: extract structured, quoted information from one course document.
 * Nothing in here is written by the AI except values derived directly from quotes.
 */

/** Bump when prompts or schemas change, so cached extractions are redone. */
export const EXTRACTION_PROMPT_VERSION = "extract-v3"

const page = z.number().int().nullable()

const statementSchema = z.object({
  kind: z.enum(STATEMENT_KINDS),
  section: z.string(),
  context: z.string(),
  quote: z.string(),
  page,
  assessed_by: z.array(z.string()),
})

const assessmentSchema = z.object({
  name: z.string(),
  weight_percent: z.number().nullable(),
  grading: z.string(),
  quote: z.string(),
  page,
})

const rubricSchema = z.object({
  assessment: z.string(),
  page,
  criteria: z.array(
    z.object({
      criterion: z.string(),
      description: z.string(),
      levels: z.array(z.object({ label: z.string(), description: z.string() })),
    }),
  ),
})

export function manualExtractionSchema(fields: readonly FieldDefinition[]) {
  return z.object({
    fields: fieldsObjectSchema(fields),
    statements: z.array(statementSchema),
    assessments: z.array(assessmentSchema),
    rubrics: z.array(rubricSchema),
  })
}

export const supplementaryExtractionSchema = z.object({
  statements: z.array(statementSchema),
  assessments: z.array(assessmentSchema),
  rubrics: z.array(rubricSchema),
})

export type ManualExtraction = z.infer<ReturnType<typeof manualExtractionSchema>>
export type SupplementaryExtraction = z.infer<typeof supplementaryExtractionSchema>
/** Course descriptions (manual, study guide) carry metadata fields; other material does not. */
export type DescriptionKind = "manual" | "study_guide"
export type DocumentExtraction =
  | ({ kind: DescriptionKind } & ManualExtraction)
  | ({ kind: "supplementary" } & SupplementaryExtraction)
export type ExtractedStatement = z.infer<typeof statementSchema>

const QUOTE_RULES = `Quoting rules (strict):
- Every "quote" must be copied verbatim from the document: same words, same order, same language (do not translate). You may drop leading bullet characters and numbering, and you may shorten a long passage by quoting only its most relevant sentence, but never paraphrase or combine separate passages.
- "page" is the 1-based page number of the PDF file where the quote starts (count every page, including the cover), or null if the document has no pages.
- For short values (codes, numbers, names), quote the whole line or table row including its label, e.g. "Course code S_AIS" rather than "S_AIS".
- Never invent information. If something is not in the document, say so through the status and leave the quote empty.`

const STATEMENT_RULES = `Learning statements ("statements"): extract every passage that states what students learn, do or are assessed on. Each statement is one item:
- kind "learning_goal": a learning objective / learning goal / intended learning outcome. Extract each objective as a separate statement; quote only the item itself.
- kind "activity": a description of what students actively do to learn (e.g. a practical, assignment, project, presentation, discussion), when it says what skill or knowledge is practised. Skip pure logistics (rooms, dates, attendance rules) and reading lists.
- kind "assessment": a description of what an assessment tests or requires of students (e.g. "This assignment will test ..." or the requirements of a final report).
- "section" is the heading of the section the statement appears in.
- "context": the verbatim sentence stem or sub-heading needed to read the statement correctly, e.g. "After completion of this course, the student is able to:" or "Knowledge and understanding - The student has acquired knowledge and understanding of:". Empty when the statement reads on its own.
- "assessed_by": only for learning goals that the document explicitly maps to assessments (e.g. an assessment matrix listing which learning objectives each assessment covers). List the assessment names exactly as in "assessments". Leave it empty when the document does not state the mapping explicitly; never infer it.

Assessments ("assessments"): every graded or required assessment component, with its weight as a percentage (null if not stated) and how it is graded (e.g. "1-10", "pass/fail").

Rubrics ("rubrics"): if the document contains assessment rubrics or grading criteria tables, extract them with their criteria and performance levels. Otherwise return an empty list.`

const DESCRIPTION_INTRO: Record<DescriptionKind, string> = {
  manual:
    "You extract structured information from a university course manual, for a quality-assurance tool. Course coordinators use your output to check whether their manual is clear and complete, so accuracy matters more than completeness.",
  study_guide:
    "You extract structured information from the public description of a university course in the online study guide, for a quality-assurance tool. Accuracy matters more than completeness.",
}

export function descriptionSystemPrompt(kind: DescriptionKind, fields: readonly FieldDefinition[]): string {
  const fieldList = fields
    .map((f) => `- ${f.key} (${describeFieldType(f.type)}): ${f.prompt}`)
    .join("\n")
  return `${DESCRIPTION_INTRO[kind]}

${QUOTE_RULES}

Metadata fields ("fields"): for each field below, return:
- "value": the value in the requested type, or null if not found;
- "status": "found" if the document states it clearly, "unclear" if it is ambiguous, contradictory or only implied, "missing" if absent;
- "quote": the verbatim passage the value is based on ("" if missing);
- "page".

Fields:
${fieldList}

${STATEMENT_RULES}`
}

export const SUPPLEMENTARY_SYSTEM_PROMPT = `You extract information from supplementary course material (e.g. assignment instructions or rubrics) for a quality-assurance tool. This is not the course manual, so do not look for course metadata.

${QUOTE_RULES}

${STATEMENT_RULES}`

export interface ExtractionInput {
  kind: DocumentKind
  filename: string
  /** PDF bytes, or the extracted text for other formats. */
  content: { type: "pdf"; data: Uint8Array } | { type: "text"; text: string }
  fields: readonly FieldDefinition[]
  model: string
}

function documentParts(input: ExtractionInput): ContentPart[] {
  const intro: ContentPart = {
    type: "text",
    text: `Document: ${input.filename} (${DOCUMENT_KIND_LABELS[input.kind].toLowerCase()}).`,
  }
  if (input.content.type === "pdf") {
    return [intro, { type: "pdf", data: input.content.data, filename: input.filename }]
  }
  return [intro, { type: "text", text: `--- DOCUMENT TEXT ---\n${input.content.text}\n--- END ---` }]
}

export async function extractDocument(
  client: LlmClient,
  input: ExtractionInput,
): Promise<{ extraction: DocumentExtraction; model: string }> {
  const content = documentParts(input)
  const kind = input.kind
  if (kind === "manual" || kind === "study_guide") {
    const result = await client.generate({
      model: input.model,
      system: descriptionSystemPrompt(kind, input.fields),
      content,
      schema: manualExtractionSchema(input.fields),
      schemaName: "course_description_extraction",
    })
    return { extraction: { kind, ...result.data }, model: result.model }
  }
  const result = await client.generate({
    model: input.model,
    system: SUPPLEMENTARY_SYSTEM_PROMPT,
    content,
    schema: supplementaryExtractionSchema,
    schemaName: "supplementary_extraction",
  })
  return { extraction: { kind: "supplementary", ...result.data }, model: result.model }
}

/** Validates cached JSON back into an extraction (the cache stores `unknown`). */
export function parseCachedExtraction(
  value: unknown,
  fields: readonly FieldDefinition[],
): DocumentExtraction | null {
  const description = manualExtractionSchema(fields)
    .extend({ kind: z.enum(["manual", "study_guide"]) })
    .safeParse(value)
  if (description.success) return description.data
  const supplementary = supplementaryExtractionSchema
    .extend({ kind: z.literal("supplementary") })
    .safeParse(value)
  return supplementary.success ? supplementary.data : null
}
