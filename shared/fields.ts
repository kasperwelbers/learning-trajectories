import { z } from "zod"

/**
 * Extraction fields: the course metadata a programme wants extracted from every course manual.
 *
 * A field has a simple structured-output type. From a list of fields we build one zod schema,
 * which is both converted to JSON schema (for the model's structured output) and used to
 * validate the model's answer.
 */

export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,47}$/

export const scalarFieldTypeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("string") }),
  z.object({ kind: z.literal("number") }),
  z.object({ kind: z.literal("boolean") }),
  z.object({
    kind: z.literal("factor"),
    levels: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
  }),
])
export type ScalarFieldType = z.infer<typeof scalarFieldTypeSchema>

export const fieldTypeSchema = z.union([
  scalarFieldTypeSchema,
  z.object({ kind: z.literal("array"), of: scalarFieldTypeSchema }),
])
export type FieldType = z.infer<typeof fieldTypeSchema>

export type ScalarValue = string | number | boolean
export type FieldValue = ScalarValue | ScalarValue[] | null

export const FIELD_STATUSES = ["found", "unclear", "missing"] as const
export type FieldStatus = (typeof FIELD_STATUSES)[number]

export interface FieldDefinition {
  key: string
  label: string
  type: FieldType
  prompt: string
  required: boolean
}

/** The fields every programme has; views depend on them, so they cannot be removed. */
export const SYSTEM_FIELDS: readonly FieldDefinition[] = [
  {
    key: "course_code",
    label: "Course code",
    type: { kind: "string" },
    prompt: "The official course code, exactly as written (e.g. S_AIS).",
    required: true,
  },
  {
    key: "course_name",
    label: "Course name",
    type: { kind: "string" },
    prompt: "The full course name.",
    required: true,
  },
  {
    key: "academic_year",
    label: "Academic year",
    type: { kind: "string" },
    prompt: "The academic year the manual applies to, formatted as YYYY-YYYY (e.g. 2025-2026).",
    required: true,
  },
  {
    key: "periods",
    label: "Periods",
    type: { kind: "array", of: { kind: "number" } },
    prompt:
      "The teaching periods (blocks) in which the course runs, as numbers. A course running in periods 4 to 6 is [4, 5, 6].",
    required: true,
  },
  {
    key: "ec",
    label: "EC",
    type: { kind: "number" },
    prompt: "The study load in European credits (EC/ECTS).",
    required: true,
  },
  {
    key: "level",
    label: "Level",
    type: { kind: "number" },
    prompt: "The course level as a number (e.g. 100, 200, 300, 400).",
    required: true,
  },
  {
    key: "coordinators",
    label: "Coordinators",
    type: { kind: "array", of: { kind: "string" } },
    prompt: "Names (or e-mail addresses if no name is given) of the course coordinator(s).",
    required: true,
  },
  {
    key: "examiner",
    label: "Examiner",
    type: { kind: "string" },
    prompt: "The examiner of the course.",
    required: false,
  },
  {
    key: "language",
    label: "Language of instruction",
    type: { kind: "string" },
    prompt: "The language(s) of instruction.",
    required: true,
  },
]

export const SYSTEM_FIELD_KEYS: ReadonlySet<string> = new Set(SYSTEM_FIELDS.map((f) => f.key))

/** Suggested non-system fields seeded for new programmes. */
export const DEFAULT_CUSTOM_FIELDS: readonly FieldDefinition[] = [
  {
    key: "has_ai_statement",
    label: "AI statement",
    type: { kind: "boolean" },
    prompt:
      "Does the manual contain a statement about the (permitted) use of generative AI by students? Quote the statement if present.",
    required: true,
  },
  {
    key: "entry_requirements",
    label: "Entry requirements",
    type: { kind: "string" },
    prompt: "Required prior knowledge or entry requirements, summarised in one sentence.",
    required: false,
  },
  {
    key: "resit_policy",
    label: "Resit policy",
    type: { kind: "string" },
    prompt: "How students can resit or repair a failing grade, summarised in one sentence.",
    required: true,
  },
]

function scalarSchema(type: ScalarFieldType): z.ZodType<ScalarValue> {
  switch (type.kind) {
    case "string":
      return z.string()
    case "number":
      return z.number()
    case "boolean":
      return z.boolean()
    case "factor": {
      const [first, ...rest] = type.levels
      if (first === undefined) return z.string()
      return z.enum([first, ...rest])
    }
  }
}

/** Zod schema for a single field value (null = not found). */
export function valueSchema(type: FieldType): z.ZodType<FieldValue> {
  if (type.kind === "array") return z.array(scalarSchema(type.of)).nullable()
  return scalarSchema(type).nullable()
}

/** The answer the model gives for every field. */
export function fieldAnswerSchema(type: FieldType) {
  return z.object({
    value: valueSchema(type),
    status: z.enum(FIELD_STATUSES),
    quote: z.string(),
    page: z.number().int().nullable(),
  })
}

export type FieldAnswer = z.infer<ReturnType<typeof fieldAnswerSchema>>

/** Zod object schema with one property per field. */
export function fieldsObjectSchema(fields: readonly FieldDefinition[]) {
  const shape: Record<string, ReturnType<typeof fieldAnswerSchema>> = {}
  for (const field of fields) shape[field.key] = fieldAnswerSchema(field.type)
  return z.object(shape)
}

export function describeFieldType(type: FieldType): string {
  switch (type.kind) {
    case "array":
      return `list of ${describeFieldType(type.of)}`
    case "factor":
      return `one of: ${type.levels.join(", ")}`
    default:
      return type.kind
  }
}

export function formatFieldValue(value: FieldValue): string {
  if (value === null) return "—"
  if (Array.isArray(value)) return value.map(String).join(", ")
  if (typeof value === "boolean") return value ? "Yes" : "No"
  return String(value)
}
