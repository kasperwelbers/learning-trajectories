import { z } from "zod"
import { toBase64 } from "./encoding"
import { parseModelJson, structuredOutputSchema } from "./jsonSchema"
import {
  InvalidModelOutput,
  LlmRequestError,
  type ContentPart,
  type GenerateRequest,
  type GenerateResult,
  type LlmClient,
} from "./types"

/**
 * Chat Completions API as implemented by OpenAI-compatible endpoints. Used for Gemini
 * (`https://generativelanguage.googleapis.com/v1beta/openai`) and for Cloudflare AI Gateway's
 * compat endpoint. PDFs are sent as data URIs, which Gemini reads natively.
 */
export class OpenAiCompatibleClient implements LlmClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async generate<T>(request: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const response = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildChatRequest(request)),
    })
    const text = await response.text()
    if (!response.ok) {
      throw new LlmRequestError(`AI request failed (${response.status}): ${errorMessage(text)}`, response.status)
    }
    const completion = completionSchema.safeParse(safeJson(text))
    if (!completion.success) throw new InvalidModelOutput("Unexpected response from the AI provider", text)
    const choice = completion.data.choices[0]
    const content = choice?.message.content
    if (!content) {
      throw new InvalidModelOutput(`The model returned no content (finish reason: ${choice?.finish_reason ?? "unknown"})`, text)
    }
    const parsed = parseModelJson(request.schema, content)
    if (!parsed.ok) throw new InvalidModelOutput(parsed.error, content)
    return { data: parsed.data, model: completion.data.model ?? request.model }
  }
}

export function buildChatRequest<T>(request: GenerateRequest<T>) {
  return {
    model: request.model,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.content.map(toChatPart) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: request.schemaName, strict: true, schema: structuredOutputSchema(request.schema) },
    },
  }
}

function toChatPart(part: ContentPart) {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text }
    case "pdf":
      return { type: "image_url", image_url: { url: `data:application/pdf;base64,${toBase64(part.data)}` } }
  }
}

const completionSchema = z.object({
  model: z.string().optional(),
  choices: z.array(
    z.object({
      finish_reason: z.string().nullish(),
      message: z.object({ content: z.string().nullish() }),
    }),
  ),
})

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Gemini wraps errors in an array; OpenAI does not. */
function errorMessage(text: string): string {
  const data = safeJson(text)
  const first: unknown = Array.isArray(data) ? data[0] : data
  const parsed = z.object({ error: z.object({ message: z.string() }) }).safeParse(first)
  return parsed.success ? parsed.data.error.message : text.slice(0, 300)
}
