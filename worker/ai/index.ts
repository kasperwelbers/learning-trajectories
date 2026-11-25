import { HttpError } from "../errors"
import { AnthropicClient } from "./anthropic"
import { OpenAiCompatibleClient } from "./openaiCompatible"
import type { LlmClient } from "./types"

export interface AiConfig {
  client: LlmClient
  extractModel: string
  linkModel: string
}

export function aiConfig(env: Env): AiConfig {
  if (!env.AI_API_KEY) {
    throw new HttpError(503, "The AI provider is not configured (AI_API_KEY is missing)", "ai_unavailable")
  }
  const client =
    env.AI_PROVIDER === "anthropic"
      ? new AnthropicClient(env.AI_API_KEY, env.AI_BASE_URL || undefined)
      : new OpenAiCompatibleClient(env.AI_BASE_URL, env.AI_API_KEY)
  return { client, extractModel: env.AI_MODEL_EXTRACT, linkModel: env.AI_MODEL_LINK }
}

export type { LlmClient } from "./types"
