import { describe, expect, it } from "vitest"
import { DocumentMatcher, normaliseForMatch } from "./verify"

describe("quote verification", () => {
  // Mimics the broken text layer of a real manual: zero-width spaces and split letters.
  const pages = [
    "​C S​ ocial Media Analytics​\nCourse code S_P4SMA",
    "● ​ifferentiate between manual and automatic content analysis techniques.\n" +
      "● list the strengths and limitations of both manual and automatic content analysis",
  ]
  const matcher = new DocumentMatcher(pages)

  it("normalises to letters and digits", () => {
    expect(normaliseForMatch("Ünïcode – text, 2025!")).toBe("unicodetext2025")
  })

  it("verifies quotes despite layout artefacts", () => {
    expect(matcher.verify("Social Media Analytics")).toBe("verified")
    expect(matcher.pageOf("list the strengths and limitations")).toBe(2)
  })

  it("accepts near matches as approximate", () => {
    expect(matcher.verify("differentiate between manual and automatic content analysis techniques")).toBe(
      "approximate",
    )
  })

  it("rejects quotes that are not in the document", () => {
    expect(matcher.verify("design a solution to a societal problem")).toBe("unverified")
    expect(matcher.verify("S_P4")).toBe("unverified")
    expect(matcher.verify("S_P4SMA")).toBe("verified")
  })
})
