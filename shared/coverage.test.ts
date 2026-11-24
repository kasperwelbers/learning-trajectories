import { describe, expect, it } from "vitest"
import {
  coveredDomains,
  flowerFromLinks,
  flowersByLto,
  heatmapCells,
  heatmapKey,
  highestLevelIndex,
  type CoverageLink,
} from "./coverage"

const link = (
  courseId: number,
  ltoId: number,
  level: "apply" | "evaluate",
  tested: boolean,
): CoverageLink => ({ courseId, ltoId, domain: "cognitive", level, tested, origin: "ai" })

describe("coverage", () => {
  it("prefers tested over taught", () => {
    const flower = flowerFromLinks([link(1, 1, "apply", false), link(2, 1, "apply", true)])
    expect(flower.cognitive.apply).toBe("tested")
    expect(coveredDomains(flower)).toEqual(["cognitive"])
  })

  it("does not infer lower levels", () => {
    const flower = flowerFromLinks([link(1, 1, "evaluate", false)])
    expect(flower.cognitive.apply).toBeUndefined()
    expect(highestLevelIndex(flower, "cognitive")).toBe(4)
    expect(highestLevelIndex(flower, "affective")).toBe(-1)
  })

  it("groups flowers per LTO", () => {
    const flowers = flowersByLto([link(1, 1, "apply", false), link(1, 2, "evaluate", true)])
    expect(flowers.get(1)?.cognitive.apply).toBe("taught")
    expect(flowers.get(2)?.cognitive.evaluate).toBe("tested")
  })

  it("counts each course once per heatmap cell", () => {
    const cells = heatmapCells([
      link(1, 1, "apply", false),
      link(1, 1, "apply", true),
      link(2, 1, "apply", false),
    ])
    expect(cells.get(heatmapKey(1, { domain: "cognitive", level: "apply" }))).toEqual({
      taught: [2],
      tested: [1],
    })
  })
})
