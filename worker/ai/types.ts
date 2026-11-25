import type { z } from "zod"

export type ContentPart =
  | { type: "text"; text: string }
  /** A PDF document sent to the model natively (the model sees pages and layout). */
  | { type: "pdf"; data: Uint8Array; filename: string }

export interface GenerateRequest<T> {
  model: string
  system: string
  content: ContentPart[]
  /** Structured output: the model must answer with JSON matching this schema. */
  schema: z.ZodType<T>
  schemaName: string
}

export interface GenerateResult<T> {
  data: T
  model: string
}

/** The only thing the pipeline knows about AI providers. */
export interface LlmClient {
  generate<T>(request: GenerateRequest<T>): Promise<GenerateResult<T>>
}

/** The model answered, but not with valid JSON for the schema. Worth retrying. */
export class InvalidModelOutput extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message)
  }
}

/** The provider rejected the request in a way retrying will not fix (bad key, bad request). */
export class LlmRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }

  get retryable(): boolean {
    return this.status === 429 || this.status >= 500
  }
}
