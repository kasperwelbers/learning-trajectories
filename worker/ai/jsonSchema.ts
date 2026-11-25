import { z } from "zod"

export type JsonSchema = Record<string, unknown>

/** JSON schema for structured output, without the `$schema` marker most providers reject. */
export function structuredOutputSchema(schema: z.ZodType): JsonSchema {
  const json: JsonSchema = z.toJSONSchema(schema, { target: "draft-2020-12", io: "output" })
  const { $schema: _ignored, ...rest } = json
  return rest
}

export function parseModelJson<T>(schema: z.ZodType<T>, raw: string): { ok: true; data: T } | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFence(raw))
  } catch {
    return { ok: false, error: "The model did not return valid JSON" }
  }
  const result = schema.safeParse(parsed)
  if (result.success) return { ok: true, data: result.data }
  const issue = result.error.issues[0]
  return { ok: false, error: `Invalid model output at ${issue?.path.join(".") ?? "?"}: ${issue?.message ?? ""}` }
}

/** Some models wrap JSON in ```json fences even in JSON mode. */
function stripCodeFence(raw: string): string {
  const trimmed = raw.trim()
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed)
  return match?.[1] ?? trimmed
}
