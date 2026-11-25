import { describe, expect, it } from "vitest"
import { parseLtoCsv } from "./ImportSettings"

describe("LTO CSV import", () => {
  it("reads the prototype's export format and ignores extra columns", () => {
    const csv =
      'trajectory,name,outcome,bloom\nAcademic Skills,AS1,"The student can create academic products (written, verbal, visual)",C6\n'
    expect(parseLtoCsv(csv)).toEqual({
      rows: [
        {
          trajectory: "Academic Skills",
          code: "AS1",
          title: "The student can create academic products (written, verbal, visual)",
        },
      ],
      error: null,
    })
  })

  it("accepts code/title headers in any case and skips incomplete rows", () => {
    const csv = "Trajectory,Code,Title\nMethods,M1,Justify choices\nMethods,,Missing code\n"
    expect(parseLtoCsv(csv).rows).toEqual([
      { trajectory: "Methods", code: "M1", title: "Justify choices" },
    ])
  })

  it("explains what is wrong with an unusable file", () => {
    expect(parseLtoCsv("a,b\n1,2").error).toMatch(/columns trajectory/)
  })
})
