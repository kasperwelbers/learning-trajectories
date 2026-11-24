import { describe, expect, it } from "vitest"
import {
  ALL_BLOOM_REFS,
  BLOOM,
  BLOOM_DOMAINS,
  levelIndex,
  levelInfo,
  parseBloomRef,
  toBloomRef,
} from "./bloom"

describe("bloom", () => {
  it("has 6 cognitive, 5 affective and 5 psychomotor levels", () => {
    expect(BLOOM.cognitive.levels).toHaveLength(6)
    expect(BLOOM.affective.levels).toHaveLength(5)
    expect(BLOOM.psychomotor.levels).toHaveLength(5)
    expect(ALL_BLOOM_REFS).toHaveLength(16)
  })

  it("keeps levels ordered from low to high", () => {
    expect(levelIndex({ domain: "cognitive", level: "remember" })).toBe(0)
    expect(levelIndex({ domain: "cognitive", level: "create" })).toBe(5)
    expect(levelIndex({ domain: "affective", level: "characterising" })).toBe(4)
  })

  it("validates domain/level combinations", () => {
    expect(parseBloomRef("cognitive", "apply")).toEqual({ domain: "cognitive", level: "apply" })
    expect(parseBloomRef("affective", "apply")).toBeNull()
    expect(parseBloomRef("spiritual", "apply")).toBeNull()
    expect(() => toBloomRef("psychomotor", "valuing")).toThrow()
  })

  it("describes every level", () => {
    for (const domain of BLOOM_DOMAINS) {
      for (const level of BLOOM[domain].levels) {
        expect(level.description.length).toBeGreaterThan(10)
        expect(levelInfo(toBloomRef(domain, level.key)).label).toBe(level.label)
      }
    }
  })
})
