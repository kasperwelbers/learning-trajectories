import type { CourseFactsDto } from "@shared/api"

/** Programme year of a course: as set, or derived from its level (100 → 1, 200 → 2, …). */
export function courseYear(course: Pick<CourseFactsDto, "programmeYear" | "level">): number | null {
  if (course.programmeYear) return course.programmeYear
  if (course.level && course.level >= 100) return Math.min(6, Math.floor(course.level / 100))
  return null
}

/** Sort key: year, then first period, then code. */
export function compareCourses(a: CourseFactsDto, b: CourseFactsDto): number {
  return (
    (courseYear(a) ?? 99) - (courseYear(b) ?? 99) ||
    (Math.min(...a.periods, 99) - Math.min(...b.periods, 99)) ||
    a.code.localeCompare(b.code)
  )
}
