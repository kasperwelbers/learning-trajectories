import { describe, expect, it } from "vitest"
import type { FieldDefinition } from "@shared/fields"
import { assembleExtractions, buildLinks, pointerRows } from "./assemble"
import type { ManualExtraction } from "./extract"
import { DocumentMatcher } from "./verify"

const fields: FieldDefinition[] = [
  {
    key: "ec",
    label: "EC",
    type: { kind: "number" },
    prompt: "",
    required: true,
  },
  {
    key: "examiner",
    label: "Examiner",
    type: { kind: "string" },
    prompt: "",
    required: false,
  },
]

function extraction(overrides: Partial<ManualExtraction>): ManualExtraction {
  return {
    fields: {
      ec: {
        value: 6,
        status: "found",
        quote: "Study load 6 EC (168 hours)",
        page: 9,
      },
      examiner: { value: null, status: "missing", quote: "", page: null },
    },
    statements: [],
    assessments: [],
    rubrics: [],
    ...overrides,
  }
}

describe("assembling extractions", () => {
  const manualText = new DocumentMatcher([
    "Cover",
    "Study load 6 EC (168 hours)\nThe student is able to: design a solution",
  ])
  const guideText = new DocumentMatcher([
    "Examiner drs. B. Slijper. Course objective: design a solution",
  ])

  it("takes metadata from the manual and falls back to the study guide", () => {
    const result = assembleExtractions(
      [
        {
          documentId: 1,
          kind: "manual",
          matcher: manualText,
          extraction: {
            kind: "manual",
            ...extraction({
              statements: [
                {
                  kind: "learning_goal",
                  section: "Goals",
                  context: "The student is able to:",
                  quote: "design a solution",
                  page: 1,
                  assessed_by: ["Report"],
                },
              ],
            }),
          },
        },
        {
          documentId: 2,
          kind: "study_guide",
          matcher: guideText,
          extraction: {
            kind: "study_guide",
            ...extraction({
              fields: {
                ec: { value: 6, status: "found", quote: "6 EC", page: null },
                examiner: {
                  value: "drs. B. Slijper",
                  status: "found",
                  quote: "Examiner drs. B. Slijper",
                  page: null,
                },
              },
              statements: [
                {
                  kind: "learning_goal",
                  section: "Course objective",
                  context: "",
                  quote: "design a solution",
                  page: null,
                  assessed_by: [],
                },
              ],
            }),
          },
        },
      ],
      fields,
    )
    expect(result.fields).toEqual([
      // The page where the quote is actually found wins over the reported page.
      {
        key: "ec",
        value: 6,
        status: "found",
        quote: "Study load 6 EC (168 hours)",
        page: 2,
        verification: "verified",
        source: "manual",
      },
      {
        key: "examiner",
        value: "drs. B. Slijper",
        status: "found",
        quote: "Examiner drs. B. Slijper",
        page: 1,
        verification: "verified",
        source: "study_guide",
      },
    ])
    expect(result.statements.map((s) => [s.ordinal, s.documentId, s.page, s.verification])).toEqual(
      [
        [1, 1, 2, "verified"],
        [2, 2, 1, "verified"],
      ],
    )

    const kinds = new Map([
      [1, "manual" as const],
      [2, "study_guide" as const],
    ])
    const byOrdinal = new Map(result.statements.map((s) => [s.ordinal, s]))
    const links = buildLinks(
      [
        {
          courseKey: 1,
          ltoId: 5,
          ref: { domain: "cognitive", level: "create" },
          statementIds: [1, 2],
          justification: "j",
          confidence: 0.9,
        },
      ],
      (id) => byOrdinal.get(id),
      kinds,
    )
    expect(links[0]).toMatchObject({
      ordinal: 5000,
      tested: true,
      sources: ["manual", "study_guide"],
      statementOrdinals: [1, 2],
    })
  })

  it("turns a judged pointer into a statement and links", () => {
    const rows = pointerRows(
      {
        id: 3,
        ltoId: 5,
        documentId: 1,
        passage: "design a solution",
        page: null,
      },
      {
        kind: "activity",
        section: "Project",
        supported: true,
        verdict: "ok",
        levels: [
          {
            ref: { domain: "cognitive", level: "create" },
            justification: "j",
            confidence: 0.8,
          },
        ],
      },
      manualText,
      "manual",
    )
    expect(rows.statement).toMatchObject({
      page: 2,
      verification: "verified",
      pointerId: 3,
    })
    expect(rows.links).toHaveLength(1)
    expect(rows.links[0]).toMatchObject({
      origin: "pointer",
      tested: false,
      sources: ["manual"],
    })
  })
})
