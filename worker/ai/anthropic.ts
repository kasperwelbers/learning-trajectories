import { z } from "zod"
import { toBase64 } from "./encoding"
import { structuredOutputSchema } from "./jsonSchema"
import {
  InvalidModelOutput,
  LlmRequestError,
  type ContentPart,
  type GenerateRequest,
  type GenerateResult,
  type LlmClient,
} from "./types"

const TOOL_NAME = "submit"

/**
 * Anthropic Messages API. Structured output is obtained by forcing a single tool call whose
 * input schema is the requested schema. PDFs are sent as document blocks.
 */
export class AnthropicClient implements LlmClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.anthropic.com/v1",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async generate<T>(request: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const response = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(buildMessagesRequest(request)),
    })
    const text = await response.text()
    if (!response.ok) {
      throw new LlmRequestError(`AI request failed (${response.status}): ${text.slice(0, 300)}`, response.status)
    }
    const message = messageSchema.safeParse(JSON.parse(text))
    if (!message.success) throw new InvalidModelOutput("Unexpected response from Anthropic", text)
    const toolUse = message.data.content.find((block) => block.type === "tool_use")
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new InvalidModelOutput(`The model did not call the tool (stop reason: ${message.data.stop_reason ?? "?"})`, text)
    }
    const parsed = request.schema.safeParse(toolUse.input)
    if (!parsed.success) {
      throw new InvalidModelOutput(`Invalid model output: ${parsed.error.issues[0]?.message ?? ""}`, JSON.stringify(toolUse.input))
    }
    return { data: parsed.data, model: message.data.model }
  }
}

export function buildMessagesRequest<T>(request: GenerateRequest<T>) {
  return {
    model: request.model,
    max_tokens: 16000,
    system: request.system,
    messages: [{ role: "user", content: request.content.map(toBlock) }],
    tools: [
      {
        name: TOOL_NAME,
        description: `Submit the ${request.schemaName} result.`,
        input_schema: structuredOutputSchema(request.schema),
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
  }
}

function toBlock(part: ContentPart) {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text }
    case "pdf":
      return {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: toBase64(part.data) },
        title: part.filename,
      }
  }
}

const messageSchema = z.object({
  model: z.string(),
  stop_reason: z.string().nullish(),
  content: z.array(
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({ type: z.literal("tool_use"), name: z.string(), input: z.unknown() }),
      z.object({ type: z.literal("thinking") }).loose(),
    ]),
  ),
})
