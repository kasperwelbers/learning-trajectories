import { conflict, notFound } from "../errors"

interface RunResult {
  meta: { changes: number }
}

/**
 * Completes an optimistic-concurrency update (`... WHERE id = ? AND version = ?`).
 * When nothing changed, the row either does not exist (404) or was changed by someone else (409).
 */
export async function assertVersionedUpdate(
  result: RunResult,
  rowExists: () => Promise<boolean>,
): Promise<void> {
  if (result.meta.changes > 0) return
  if (await rowExists()) throw conflict()
  throw notFound()
}

export function assertChanged(result: RunResult, what = "Not found"): void {
  if (result.meta.changes === 0) throw notFound(what)
}

/** SQLite constraint violations surface as generic errors; detect unique violations. */
export function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? `${error.message} ${String(error.cause)}` : ""
  return message.includes("UNIQUE constraint failed")
}
