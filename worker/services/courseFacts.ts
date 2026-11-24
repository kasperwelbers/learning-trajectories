import { and, eq, inArray } from "drizzle-orm"
import type { CourseFactsDto } from "@shared/api"
import type { FieldValue } from "@shared/fields"
import type { Db } from "../db/client"
import { inChunks } from "../db/batching"
import { analyses, analysisFields, courses } from "../db/schema"

export type AnalysisRow = typeof analyses.$inferSelect
export type CourseRow = typeof courses.$inferSelect

export interface CourseWithAnalysis {
  course: CourseRow
  /** Analysis for exactly the selected year (may still be running or have failed). */
  current: AnalysisRow | null
  /** Most recent analysis with results for the selected year or earlier. */
  effective: AnalysisRow | null
}

/**
 * For each course: its analysis for the selected year, and the analysis whose results views
 * should show. When a course has no manual for the selected year yet, views fall back to the
 * most recent earlier year.
 */
export async function coursesWithAnalyses(
  db: Db,
  programmeId: string,
  year: string,
): Promise<CourseWithAnalysis[]> {
  const [courseRows, analysisRows] = await Promise.all([
    db.select().from(courses).where(eq(courses.programmeId, programmeId)).orderBy(courses.code),
    db.select().from(analyses).where(eq(analyses.programmeId, programmeId)),
  ])
  return courseRows.map((course) => {
    const own = analysisRows.filter((a) => a.courseId === course.id)
    const current = own.find((a) => a.year === year) ?? null
    const effective =
      own
        .filter((a) => a.hasResults && a.year <= year)
        .sort((a, b) => b.year.localeCompare(a.year))[0] ?? null
    return { course, current, effective }
  })
}

const FACT_KEYS = ["periods", "level", "ec"] as const

function numberOrNull(value: FieldValue | null | undefined): number | null {
  return typeof value === "number" ? value : null
}

function numberList(value: FieldValue | null | undefined): number[] {
  if (Array.isArray(value)) return value.filter((v): v is number => typeof v === "number")
  return typeof value === "number" ? [value] : []
}

/** Course facts (periods, level, EC) taken from each course's effective analysis. */
export async function courseFacts(
  db: Db,
  items: readonly CourseWithAnalysis[],
): Promise<CourseFactsDto[]> {
  const analysisIds = items.flatMap((i) => (i.effective ? [i.effective.id] : []))
  const rows = await inChunks(analysisIds, (chunk) =>
    db
      .select({ analysisId: analysisFields.analysisId, key: analysisFields.key, value: analysisFields.value })
      .from(analysisFields)
      .where(and(inArray(analysisFields.analysisId, chunk), inArray(analysisFields.key, [...FACT_KEYS]))),
  )
  const values = new Map(rows.map((r) => [`${r.analysisId}|${r.key}`, r.value]))
  return items.map(({ course, effective }) => {
    const get = (key: (typeof FACT_KEYS)[number]) =>
      effective ? values.get(`${effective.id}|${key}`) : undefined
    return {
      id: course.id,
      code: course.code,
      name: course.name,
      analysisYear: effective?.year ?? null,
      periods: numberList(get("periods")),
      level: numberOrNull(get("level")),
      ec: numberOrNull(get("ec")),
    }
  })
}
