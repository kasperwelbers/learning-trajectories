import { describe, expect, it } from "vitest"
import { linkingUserPrompt, sanitiseLinks, stripMarkdownImages, type LinkingCourse, type LinkingLto } from "./link"

const lto: LinkingLto = {
  id: 7,
  code: "MTSR-A3",
  title: "The student can justify and critique the validity of measurement instruments",
  narrative: "Validity is central. ![diagram](/api/p/x/images/a.png)",
  trajectory: { name: "Methods", narrative: "Methods narrative" },
}

const courses: LinkingCourse[] = [
  {
    key: 100,
    code: "S_SMA",
    name: "Social Media Analytics",
    statements: [
      { id: 1, kind: "learning_goal", section: "Goals", context: "The student is able to:", quote: "reflect on validity", assessedBy: [], source: "manual" },
      { id: 2, kind: "assessment", section: "Assessment", context: "", quote: "The report tests validity", assessedBy: [], source: "manual" },
    ],
  },
  {
    key: 200,
    code: "S_AIS",
    name: "AI & Society",
    statements: [{ id: 3, kind: "learning_goal", section: "Goals", context: "", quote: "critically think", assessedBy: ["Exam"], source: "study_guide" }],
  },
]

describe("linking", () => {
  it("renders the LTO in its trajectory context, without images", () => {
    const prompt = linkingUserPrompt(lto, courses)
    expect(prompt).toContain("# Trajectory: Methods")
    expect(prompt).toContain("# LTO MTSR-A3")
    expect(prompt).not.toContain("diagram")
    expect(prompt).toContain("[1] (learning_goal; course manual; section \"Goals\") The student is able to: … reflect on validity")
    expect(prompt).toContain("assessed_by: Exam")
    expect(stripMarkdownImages("a ![x](y) b")).toBe("a  b")
  })

  it("splits links per course, merges duplicates and drops invalid ones", () => {
    const links = sanitiseLinks(
      {
        courses: [
          { course_code: "S_SMA", core_subject_addressed: true, reason: "" },
          { course_code: "S_AIS", core_subject_addressed: true, reason: "" },
          { course_code: "S_X", core_subject_addressed: false, reason: "" },
        ],
        links: [
          { domain: "cognitive", level: "evaluate", course_code: "S_SMA", statement_ids: [1, 3, 99], justification: " ok ", confidence: 1.4 },
          { domain: "cognitive", level: "evaluate", course_code: "S_SMA", statement_ids: [2], justification: "dup", confidence: 0.5 },
          { domain: "affective", level: "apply", course_code: "S_SMA", statement_ids: [1], justification: "invalid level", confidence: 1 },
          { domain: "cognitive", level: "apply", course_code: "S_SMA", statement_ids: [42], justification: "unknown statement", confidence: 1 },
          { domain: "cognitive", level: "apply", course_code: "s_x", statement_ids: [1], justification: "rejected course", confidence: 1 },
        ],
      },
      lto.id,
      courses,
    )
    expect(links).toEqual([
      { courseKey: 100, ltoId: 7, ref: { domain: "cognitive", level: "evaluate" }, statementIds: [1, 2], justification: "ok", confidence: 1 },
      { courseKey: 200, ltoId: 7, ref: { domain: "cognitive", level: "evaluate" }, statementIds: [3], justification: "ok", confidence: 1 },
    ])
  })
})
