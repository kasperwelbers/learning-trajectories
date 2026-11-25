import { and, eq, inArray } from "drizzle-orm"
import type { Db } from "../db/client"
import { analyses, documents, ltos, pointers } from "../db/schema"
import { invalid } from "../errors"

export type WorkflowParams =
  | { kind: "analysis"; analysisId: number }
  | { kind: "pointer"; pointerId: number }
  /** Re-link one LTO in every analysis, after waiting `delaySeconds` for further edits. */
  | { kind: "relink"; ltoId: number; delaySeconds: number }

/** Queue a full analysis of a course for a year. Returns the analysis id. */
export async function startAnalysis(
  env: Env,
  db: Db,
  programmeId: string,
  courseId: number,
  year: string,
): Promise<number> {
  const description = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.courseId, courseId),
        eq(documents.year, year),
        inArray(documents.kind, ["manual", "study_guide"]),
      ),
    )
    .get()
  if (!description) throw invalid("Add the course manual or study guide page for this year first")

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
    .onConflictDoUpdate({
      target: [analyses.courseId, analyses.year],
      set: values,
    })
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
  await env.ANALYSIS_WORKFLOW.create({
    id: `pointer-${pointerId}-${Date.now()}`,
    params,
  })
}

/** Default wait before re-linking an edited LTO, so a burst of edits causes one re-link. */
const RELINK_DELAY_SECONDS = 120

/**
 * Re-link one LTO in all analyses. Each call supersedes earlier pending re-links of that LTO,
 * which notice this after their delay and stop.
 */
export async function startLtoRelink(
  env: Env,
  db: Db,
  ltoId: number,
  delaySeconds = RELINK_DELAY_SECONDS,
): Promise<void> {
  const workflowId = `relink-${ltoId}-${Date.now()}`
  await db.update(ltos).set({ relinkWorkflowId: workflowId }).where(eq(ltos.id, ltoId))
  const params: WorkflowParams = { kind: "relink", ltoId, delaySeconds }
  await env.ANALYSIS_WORKFLOW.create({ id: workflowId, params })
}

/** Re-link the given LTOs, but only when there are analysed courses to link them to. */
export async function relinkLtos(
  env: Env,
  db: Db,
  programmeId: string,
  ltoIds: readonly number[],
): Promise<void> {
  if (ltoIds.length === 0) return
  const analysed = await db
    .select({ id: analyses.id })
    .from(analyses)
    .where(and(eq(analyses.programmeId, programmeId), eq(analyses.hasResults, true)))
    .get()
  if (!analysed) return
  for (const ltoId of ltoIds) await startLtoRelink(env, db, ltoId)
}
