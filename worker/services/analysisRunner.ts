import { and, eq } from "drizzle-orm"
import type { Db } from "../db/client"
import { analyses, documents, pointers } from "../db/schema"
import { invalid } from "../errors"

export type WorkflowParams =
  | { kind: "analysis"; analysisId: number }
  | { kind: "pointer"; pointerId: number }

/** Queue a full analysis of a course for a year. Returns the analysis id. */
export async function startAnalysis(
  env: Env,
  db: Db,
  programmeId: string,
  courseId: number,
  year: string,
): Promise<number> {
  const manual = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.courseId, courseId), eq(documents.year, year), eq(documents.kind, "manual")))
    .get()
  if (!manual) throw invalid("Upload the course manual for this year first")

  const workflowId = `analysis-${courseId}-${year}-${Date.now()}`
  const values = {
    status: "queued" as const,
    step: null,
    error: null,
    workflowId,
    startedAt: Date.now(),
    finishedAt: null,
  }
  const row = await db
    .insert(analyses)
    .values({ programmeId, courseId, year, ...values })
    .onConflictDoUpdate({ target: [analyses.courseId, analyses.year], set: values })
    .returning({ id: analyses.id })
    .get()
  const params: WorkflowParams = { kind: "analysis", analysisId: row.id }
  await env.ANALYSIS_WORKFLOW.create({ id: workflowId, params })
  return row.id
}

/** Ask the AI to judge a coordinator's pointer, if the course already has results that year. */
export async function startPointerJudgement(env: Env, db: Db, pointerId: number): Promise<void> {
  const pointer = await db.select().from(pointers).where(eq(pointers.id, pointerId)).get()
  if (!pointer) return
  const analysis = await db
    .select({ hasResults: analyses.hasResults })
    .from(analyses)
    .where(and(eq(analyses.courseId, pointer.courseId), eq(analyses.year, pointer.year)))
    .get()
  // Without results the pointer stays pending and is judged by the next analysis run.
  if (!analysis?.hasResults) return
  const params: WorkflowParams = { kind: "pointer", pointerId }
  await env.ANALYSIS_WORKFLOW.create({ id: `pointer-${pointerId}-${Date.now()}`, params })
}
