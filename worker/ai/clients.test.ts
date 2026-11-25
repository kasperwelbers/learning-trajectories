import { z } from "zod"
import { describe, expect, it } from "vitest"
import { buildMessagesRequest } from "./anthropic"
import { parseModelJson } from "./jsonSchema"
import { OpenAiCompatibleClient, buildChatRequest } from "./openaiCompatible"
import { InvalidModelOutput, LlmRequestError } from "./types"

const schema = z.object({ answer: z.string().nullable() })
const request = {
  model: "m",
  system: "sys",
  content: [
    { type: "text" as const, text: "hi" },
    { type: "pdf" as const, data: new Uint8Array([37, 80, 68, 70]), filename: "a.pdf" },
  ],
  schema,
  schemaName: "test",
}

describe("AI clients", () => {
  it("builds an OpenAI-compatible request with a strict JSON schema and an inline PDF", () => {
    const body = buildChatRequest(request)
    expect(body.response_format.json_schema.schema).not.toHaveProperty("$schema")
    expect(body.response_format.json_schema.schema).toMatchObject({ type: "object", required: ["answer"] })
    expect(JSON.stringify(body.messages[1])).toContain("data:application/pdf;base64,JVBERg==")
  })

  it("builds an Anthropic request that forces the submit tool", () => {
    const body = buildMessagesRequest(request)
    expect(body.tool_choice).toEqual({ type: "tool", name: "submit" })
    expect(JSON.stringify(body.messages)).toContain('"type":"document"')
  })

  it("parses fenced JSON and reports schema problems", () => {
    expect(parseModelJson(schema, '```json\n{"answer":"x"}\n```')).toEqual({ ok: true, data: { answer: "x" } })
    expect(parseModelJson(schema, '{"answer":3}').ok).toBe(false)
    expect(parseModelJson(schema, "nope").ok).toBe(false)
  })

  it("maps provider responses to results and errors", async () => {
    const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status })
    const ok = new OpenAiCompatibleClient("https://x", "k", reply(200, { model: "m1", choices: [{ message: { content: '{"answer":null}' } }] }))
    await expect(ok.generate(request)).resolves.toEqual({ data: { answer: null }, model: "m1" })

    const bad = new OpenAiCompatibleClient("https://x", "k", reply(200, { choices: [{ message: { content: '{"wrong":1}' } }] }))
    await expect(bad.generate(request)).rejects.toBeInstanceOf(InvalidModelOutput)

    const limited = new OpenAiCompatibleClient("https://x", "k", reply(429, [{ error: { message: "slow down" } }]))
    const error = await limited.generate(request).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LlmRequestError)
    expect(error instanceof LlmRequestError && error.retryable).toBe(true)
  })
})
