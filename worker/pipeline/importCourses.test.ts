import { describe, expect, it } from "vitest"
import { flattenVuCurriculum, parseVuPeriods, programmeYearFrom } from "./importCourses"

describe("VU study guide import", () => {
  it("parses period codes", () => {
    expect(parseVuPeriods("P4")).toEqual([4])
    expect(parseVuPeriods("P5+6")).toEqual([5, 6])
    expect(parseVuPeriods("Ac. Year")).toEqual([])
  })

  it("derives the programme year from group descriptions", () => {
    expect(programmeYearFrom("Bachelor's programme in Communication Science year 1")).toBe(1)
    expect(programmeYearFrom("Second year bachelor")).toBe(2)
    expect(programmeYearFrom("Free Choice Electives")).toBeNull()
  })

  it("flattens nested groups and marks electives", () => {
    const course = (code: string, period = "P4") => ({
      code,
      name: code,
      credits: "6",
      periods: [{ code: period }],
    })
    const courses = flattenVuCurriculum(
      [
        {
          code: "S_B_2",
          type: "CS",
          description: "Second year bachelor",
          courses: [course("S_MCPO", "P1")],
          moduleGroups: [
            {
              code: "k2",
              type: "Obligatory choice",
              description: "Social Science for Society 2",
              courses: [course("S_AIS", "P5")],
              moduleGroups: [],
            },
          ],
        },
        {
          code: "S_KCS",
          type: "Free Choice",
          description: "Electives",
          courses: [],
          moduleGroups: [
            {
              code: "M",
              type: "Minor",
              description: "Minor Brain",
              courses: [course("AB_1")],
              moduleGroups: [],
            },
          ],
        },
      ],
      "en",
      "2026-2027",
    )
    expect(courses.map((c) => [c.code, c.programmeYear, c.suggested])).toEqual([
      ["S_MCPO", 2, true],
      ["S_AIS", 2, true],
      ["AB_1", null, false],
    ])
    expect(courses[1]?.url).toBe("https://studiegids.vu.nl/en/courses/2026-2027/S_AIS")
    expect(courses[1]?.periods).toEqual([5])
  })
})
