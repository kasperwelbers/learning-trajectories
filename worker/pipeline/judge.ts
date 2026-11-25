import { z } from "zod"
import { ALL_LEVEL_KEYS, BLOOM_DOMAINS, parseBloomRef, type BloomRef } from "@shared/bloom"
import { STATEMENT_KINDS, type StatementKind } from "@shared/evidence"
import type { ContentPart, LlmClient } from "../ai/types"
import { LINKING_SYSTEM_PROMPT, ltoText, type LinkingLto } from "./link"

/**
 * "Point and judge": a course coordinator points at a passage they believe supports an LTO.
 * The AI judges it with the same rules as automatic linking. The coordinator's own note is
 * deliberately not sent: the passage has to speak for itself.
 */

export const judgementSchema = z.object({
  kind: z.enum(STATEMENT_KINDS),
  section: z.string(),
  supported: z.boolean(),
  verdict: z.string(),
  levels: z.array(
    z.object({
      domain: z.enum(BLOOM_DOMAINS),
      level: z.enum(ALL_LEVEL_KEYS),
      justification: z.string(),
      confidence: z.number(),
    }),
  ),
})

export interface Judgement {
  kind: StatementKind
  section: string
  supported: boolean
  verdict: string
  levels: { ref: BloomRef; justification: string; confidence: number }[]
}

const JUDGE_INSTRUCTIONS = `${LINKING_SYSTEM_PROMPT}

In this task you judge a single passage that a course coordinator pointed at, because they believe it shows the course contributes to the LTO. The full course document is attached for context. Apply exactly the same rules as above:
- "kind": what kind of statement the passage is (learning_goal, activity or assessment), judged from where it appears in the document.
- "section": the heading of the section the passage appears in.
- "supported": true only if the passage itself provides evidence for the LTO. Do not be swayed by the fact that someone pointed at it.
- "levels": the Bloom levels the passage evidences for this LTO (empty when not supported), each with a justification and confidence.
- "verdict": one or two sentences for the coordinator explaining your judgement.`

export async function judgePassage(
  client: LlmClient,
  model: string,
  input: {
    lto: LinkingLto
    passage: string
    document: { filename: string; content: { type: "pdf"; data: Uint8Array } | { type: "text"; text: string } }
  },
): Promise<{ judgement: Judgement; model: string }> {
  const { lto, passage, document } = input
  const content: ContentPart[] = [
    { type: "text", text: `${ltoText(lto)}\n\n# Passage the coordinator pointed at\n${passage}\n\n# Course document: ${document.filename}` },
    document.content.type === "pdf"
      ? { type: "pdf", data: document.content.data, filename: document.filename }
      : { type: "text", text: document.content.text },
  ]
  const result = await client.generate({
    model,
    system: JUDGE_INSTRUCTIONS,
    content,
    schema: judgementSchema,
    schemaName: "pointer_judgement",
  })
  const levels = result.data.levels.flatMap((l) => {
    const ref = parseBloomRef(l.domain, l.level)
    return ref ? [{ ref, justification: l.justification.trim(), confidence: Math.min(1, Math.max(0, l.confidence)) }] : []
  })
  return {
    judgement: {
      kind: result.data.kind,
      section: result.data.section,
      supported: result.data.supported && levels.length > 0,
      verdict: result.data.verdict.trim(),
      levels,
    },
    model: result.model,
  }
}
