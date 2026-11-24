import { zValidator } from "@hono/zod-validator"
import type { ValidationTargets } from "hono"
import type { z } from "zod"
import { invalid } from "./errors"

/** zod validation that answers with our standard error body. */
export function validate<T extends z.ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      const issue = result.error.issues[0]
      const where = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""
      throw invalid(`${where}${issue?.message ?? "Invalid request"}`)
    }
  })
}

/** Parse a numeric route parameter. */
export function intParam(value: string | undefined): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) throw invalid("Invalid id")
  return n
}
