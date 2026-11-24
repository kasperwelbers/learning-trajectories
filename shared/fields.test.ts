import { z } from "zod"
import { describe, expect, it } from "vitest"
import { fieldsObjectSchema, formatFieldValue, SYSTEM_FIELDS, valueSchema } from "./fields"

describe("field types", () => {
  it("validates values per type", () => {
    expect(valueSchema({ kind: "number" }).safeParse(6).success).toBe(true)
    expect(valueSchema({ kind: "number" }).safeParse("6").success).toBe(false)
    expect(valueSchema({ kind: "factor", levels: ["a", "b"] }).safeParse("b").success).toBe(true)
    expect(valueSchema({ kind: "factor", levels: ["a", "b"] }).safeParse("c").success).toBe(false)
    expect(
      valueSchema({ kind: "array", of: { kind: "number" } }).safeParse([4, 5, 6]).success,
    ).toBe(true)
    expect(valueSchema({ kind: "boolean" }).safeParse(null).success).toBe(true)
  })

  it("builds a JSON schema with one property per field", () => {
    const schema = fieldsObjectSchema(SYSTEM_FIELDS)
    const json = z.toJSONSchema(schema)
    expect(json.type).toBe("object")
    expect(Object.keys(json.properties ?? {})).toEqual(SYSTEM_FIELDS.map((f) => f.key))
    expect(json.required).toEqual(SYSTEM_FIELDS.map((f) => f.key))
  })

  it("formats values for display", () => {
    expect(formatFieldValue(null)).toBe("—")
    expect(formatFieldValue([4, 5])).toBe("4, 5")
    expect(formatFieldValue(true)).toBe("Yes")
  })
})
