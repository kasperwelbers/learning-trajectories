import { z } from "zod"
import {
  ALL_LEVEL_KEYS,
  BLOOM,
  BLOOM_DOMAINS,
  parseBloomRef,
  type BloomRef,
} from "@shared/bloom"
import { STATEMENT_KINDS, type StatementKind } from "@shared/evidence"
import type { LlmClient } from "../ai/types"

/**
 * Step 2 of the pipeline: link a course's learning statements to the programme's LTOs at
 * specific Bloom levels. The AI only selects evidence and writes a short justification.
 */

export const LINKING_PROMPT_VERSION = "link-v1"

export interface LinkingLto {
  id: number
  code: string
  title: string
  narrative: string
  trajectory: { name: string; narrative: string }
}

export interface LinkingStatement {
  /** Local id, unique within one linking request. */
  id: number
  kind: StatementKind
  section: string
  /** Sentence stem the quote continues (e.g. "The student is able to:"), or "". */
  context: string
  quote: string
  assessedBy: string[]
  /** Whether the statement comes from the manual or from supplementary material. */
  source: "manual" | "supplementary"
}

export interface ProposedLink {
  ltoId: number
  ref: BloomRef
  statementIds: number[]
  justification: string
  confidence: number
}

export const linkingOutputSchema = z.object({
  links: z.array(
    z.object({
      lto_id: z.number().int(),
      domain: z.enum(BLOOM_DOMAINS),
      level: z.enum(ALL_LEVEL_KEYS),
      statement_ids: z.array(z.number().int()),
      justification: z.string(),
      confidence: z.number(),
    }),
  ),
})

function taxonomyText(): string {
  return BLOOM_DOMAINS.map((domain) => {
    const info = BLOOM[domain]
    const levels = info.levels
      .map((l, i) => `  ${i + 1}. ${l.key} — ${l.description} (typical verbs: ${l.verbs.join(", ")})`)
      .join("\n")
    return `${info.label} domain (${info.description}):\n${levels}`
  }).join("\n\n")
}

export const LINKING_SYSTEM_PROMPT = `You are an educational expert helping a university programme map its courses onto its learning trajectories. A learning trajectory has learning trajectory outcomes (LTOs): what graduates should be able to do. Each LTO has a narrative written by the trajectory coordinator explaining what it means and how it is built up.

You receive the LTOs and the learning statements extracted verbatim from one course's documents. Your task: decide which statements provide evidence that the course contributes to which LTO, and at which Bloom level.

Bloom's taxonomy, in three domains:

${taxonomyText()}

Rules:
1. Evidence comes only from the given statements. Cite them by id in "statement_ids". Never rely on what a course of this name would typically cover.
2. Link a statement to an LTO only when its content substantively matches what the LTO means according to its title and narrative. A shared keyword is not enough. Prefer precision over recall: leave a link out when in doubt.
3. Determine the level from what students actually do in the statement (its verb and task), not from the wording of the LTO. Judge the cognitive, affective and psychomotor domains separately; most evidence is cognitive.
4. Levels are not cumulative: do not add lower levels just because a higher level is evidenced. Add a separate link for each level that has its own evidence.
5. Produce one link per combination of LTO, domain and level, citing all statements that support it.
6. "justification": one or two sentences explaining why the cited statements show this level for this LTO. Refer to the statements, not to the course in general.
7. "confidence": between 0 and 1, how clearly the statements support the link.
8. Statements of kind "assessment", and learning goals with "assessed_by", show what is tested; activities and other learning goals show what is taught. Use them all as evidence in the same way; the distinction is made afterwards.`

function ltoText(ltos: readonly LinkingLto[]): string {
  const byTrajectory = new Map<string, LinkingLto[]>()
  for (const lto of ltos) {
    byTrajectory.set(lto.trajectory.name, [...(byTrajectory.get(lto.trajectory.name) ?? []), lto])
  }
  return [...byTrajectory.entries()]
    .map(([name, items]) => {
      const narrative = items[0]?.trajectory.narrative.trim()
      const header = `## Trajectory: ${name}${narrative ? `\n${stripMarkdownImages(narrative)}` : ""}`
      const body = items
        .map(
          (lto) =>
            `### LTO id=${lto.id} (${lto.code}): ${lto.title}${
              lto.narrative.trim() ? `\n${stripMarkdownImages(lto.narrative.trim())}` : ""
            }`,
        )
        .join("\n\n")
      return `${header}\n\n${body}`
    })
    .join("\n\n")
}

function statementText(statements: readonly LinkingStatement[]): string {
  return statements
    .map((s) => {
      const assessed = s.assessedBy.length > 0 ? ` | assessed_by: ${s.assessedBy.join(", ")}` : ""
      const context = s.context ? `${s.context} … ` : ""
      return `[${s.id}] (${s.kind}, ${s.source}, section "${s.section}"${assessed}) ${context}${s.quote}`
    })
    .join("\n")
}

/** Narratives may embed images; the model only needs the text. */
export function stripMarkdownImages(markdown: string): string {
  return markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim()
}

export function linkingUserPrompt(
  course: { code: string; name: string },
  ltos: readonly LinkingLto[],
  statements: readonly LinkingStatement[],
): string {
  return `# LTOs\n\n${ltoText(ltos)}\n\n# Course ${course.code}: ${course.name}\n\nLearning statements (kinds: ${STATEMENT_KINDS.join(", ")}):\n${statementText(statements)}`
}

/** Drops links that cite unknown LTOs or statements, or invalid domain/level combinations. */
export function sanitiseLinks(
  raw: z.infer<typeof linkingOutputSchema>,
  ltoIds: ReadonlySet<number>,
  statementIds: ReadonlySet<number>,
): ProposedLink[] {
  const merged = new Map<string, ProposedLink>()
  for (const link of raw.links) {
    const ref = parseBloomRef(link.domain, link.level)
    const cited = [...new Set(link.statement_ids.filter((id) => statementIds.has(id)))]
    if (!ref || !ltoIds.has(link.lto_id) || cited.length === 0) continue
    const key = `${link.lto_id}|${ref.domain}|${ref.level}`
    const existing = merged.get(key)
    if (existing) {
      existing.statementIds = [...new Set([...existing.statementIds, ...cited])]
      existing.confidence = Math.max(existing.confidence, link.confidence)
      continue
    }
    merged.set(key, {
      ltoId: link.lto_id,
      ref,
      statementIds: cited,
      justification: link.justification.trim(),
      confidence: Math.min(1, Math.max(0, link.confidence)),
    })
  }
  return [...merged.values()]
}

export async function linkStatements(
  client: LlmClient,
  model: string,
  course: { code: string; name: string },
  ltos: readonly LinkingLto[],
  statements: readonly LinkingStatement[],
): Promise<{ links: ProposedLink[]; model: string }> {
  if (ltos.length === 0 || statements.length === 0) return { links: [], model }
  const result = await client.generate({
    model,
    system: LINKING_SYSTEM_PROMPT,
    content: [{ type: "text", text: linkingUserPrompt(course, ltos, statements) }],
    schema: linkingOutputSchema,
    schemaName: "lto_links",
  })
  return {
    links: sanitiseLinks(
      result.data,
      new Set(ltos.map((l) => l.id)),
      new Set(statements.map((s) => s.id)),
    ),
    model: result.model,
  }
}
