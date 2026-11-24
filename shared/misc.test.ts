import { describe, expect, it } from "vitest"
import { academicYearOf, academicYearSchema, shiftAcademicYear, sortAcademicYears } from "./academicYear"
import { canEditCourse, canEditTrajectory, isProgrammeAdmin } from "./roles"
import { parseHubMessage } from "./topics"

describe("academic years", () => {
  it("validates the format", () => {
    expect(academicYearSchema.safeParse("2025-2026").success).toBe(true)
    expect(academicYearSchema.safeParse("2025-2027").success).toBe(false)
    expect(academicYearSchema.safeParse("25-26").success).toBe(false)
  })
  it("derives the year from a date", () => {
    expect(academicYearOf(new Date(2026, 7, 31))).toBe("2025-2026")
    expect(academicYearOf(new Date(2026, 8, 1))).toBe("2026-2027")
  })
  it("shifts and sorts", () => {
    expect(shiftAcademicYear("2025-2026", -1)).toBe("2024-2025")
    expect(sortAcademicYears(["2024-2025", "2026-2027", "2024-2025"])).toEqual([
      "2026-2027",
      "2024-2025",
    ])
  })
})

describe("roles", () => {
  it("scopes coordinator rights", () => {
    const access = {
      kind: "member" as const,
      roles: [{ role: "course_coordinator" as const, courseId: 3 }],
    }
    expect(canEditCourse(access, 3)).toBe(true)
    expect(canEditCourse(access, 4)).toBe(false)
    expect(canEditTrajectory(access, 3)).toBe(false)
    expect(isProgrammeAdmin(access)).toBe(false)
    expect(canEditCourse({ kind: "member", roles: [{ role: "admin" }] }, 4)).toBe(true)
    expect(canEditCourse({ kind: "share" }, 4)).toBe(false)
  })
})

describe("hub messages", () => {
  it("parses valid messages and drops unknown topics", () => {
    expect(parseHubMessage('{"type":"invalidate","topics":["courses","course:3","bogus"]}')).toEqual(
      { type: "invalidate", topics: ["courses", "course:3"] },
    )
    expect(parseHubMessage("not json")).toBeNull()
  })
})
