import { HttpError } from "../errors"
import { outboundFetch } from "../outbound"
import { AnthropicClient } from "./anthropic"
import { OpenAiCompatibleClient } from "./openaiCompatible"
import type { LlmClient } from "./types"

interface AiConfig {
  client: LlmClient
  extractModel: string
  linkModel: string
}

export function aiConfig(env: Env): AiConfig {
  if (!env.AI_API_KEY) {
    throw new HttpError(
      503,
      "The AI provider is not configured (AI_API_KEY is missing)",
      "ai_unavailable",
    )
  }
  const fetchImpl = outboundFetch(env)
  const client =
    env.AI_PROVIDER === "anthropic"
      ? new AnthropicClient(env.AI_API_KEY, env.AI_BASE_URL || undefined, fetchImpl)
      : new OpenAiCompatibleClient(env.AI_BASE_URL, env.AI_API_KEY, fetchImpl)
  return {
    client,
    extractModel: env.AI_MODEL_EXTRACT,
    linkModel: env.AI_MODEL_LINK,
  }
}
