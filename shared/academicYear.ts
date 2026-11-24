import { z } from "zod"

/** Academic years are written as "2025-2026". */
export const academicYearSchema = z
  .string()
  .regex(/^\d{4}-\d{4}$/, "Use the format YYYY-YYYY")
  .refine((value) => {
    const [start, end] = value.split("-").map(Number)
    return start !== undefined && end === start + 1
  }, "The second year must follow the first")

export type AcademicYear = z.infer<typeof academicYearSchema>

/** The academic year a date falls in, assuming the year starts on 1 September. */
export function academicYearOf(date: Date): string {
  const year = date.getFullYear()
  const start = date.getMonth() >= 8 ? year : year - 1
  return `${start}-${start + 1}`
}

export function shiftAcademicYear(year: string, delta: number): string {
  const start = Number(year.slice(0, 4)) + delta
  return `${start}-${start + 1}`
}

/** Newest first. */
export function sortAcademicYears(years: Iterable<string>): string[] {
  return [...new Set(years)].sort((a, b) => b.localeCompare(a))
}
