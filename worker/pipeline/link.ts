import { z } from "zod"
import { ALL_LEVEL_KEYS, BLOOM, BLOOM_DOMAINS, parseBloomRef, type BloomRef } from "@shared/bloom"
import { DOCUMENT_KIND_LABELS, type DocumentKind, type StatementKind } from "@shared/evidence"
import type { LlmClient } from "../ai/types"

/**
 * Step 2 of the pipeline: link learning statements to an LTO at specific Bloom levels.
 *
 * Every call judges exactly one LTO, read in the context of its own trajectory only. The same
 * evidence therefore always gets the same judgement, regardless of which other LTOs exist, and
 * editing one LTO only requires re-linking that LTO. A call can cover one course (after a new
 * analysis) or many courses (after an LTO edit).
 */

export const LINKING_PROMPT_VERSION = "link-v3"

export interface LinkingLto {
  id: number
  code: string
  title: string
  narrative: string
  trajectory: { name: string; narrative: string }
}

export interface LinkingStatement {
  /** Unique within one linking request. */
  id: number
  kind: StatementKind
  section: string
  /** Sentence stem the quote continues (e.g. "The student is able to:"), or "". */
  context: string
  quote: string
  assessedBy: string[]
  source: DocumentKind
}

export interface LinkingCourse {
  /** Caller's key for the course (e.g. analysis id); returned on each proposed link. */
  key: number
  code: string
  name: string
  statements: LinkingStatement[]
}

export interface ProposedLink {
  courseKey: number
  ltoId: number
  ref: BloomRef
  statementIds: number[]
  justification: string
  confidence: number
}

export const linkingOutputSchema = z.object({
  courses: z.array(
    z.object({
      course_code: z.string(),
      core_subject_addressed: z.boolean(),
      reason: z.string(),
    }),
  ),
  links: z.array(
    z.object({
      domain: z.enum(BLOOM_DOMAINS),
      level: z.enum(ALL_LEVEL_KEYS),
      course_code: z.string(),
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
      .map(
        (l, i) => `  ${i + 1}. ${l.key} — ${l.description} (typical verbs: ${l.verbs.join(", ")})`,
      )
      .join("\n")
    return `${info.label} domain (${info.description}):\n${levels}`
  }).join("\n\n")
}

export const LINKING_SYSTEM_PROMPT = `You are an educational expert helping a university programme map its courses onto its learning trajectories. A learning trajectory has learning trajectory outcomes (LTOs): what graduates should be able to do. The trajectory coordinator wrote narratives explaining what the trajectory and each LTO mean and how they are built up.

You receive one LTO, the narrative of its trajectory, and the learning statements extracted verbatim from the documents of one or more courses. Decide which statements provide evidence that a course contributes to this LTO, and at which Bloom level.

Bloom's taxonomy, in three domains:

${taxonomyText()}

Work in two stages.

Stage 1 ("courses"): for every course, first decide whether the course addresses the core subject of this LTO: the specific knowledge, skill or attitude that makes this LTO different from the other outcomes in the programme. Generic academic skills such as critical thinking, collaboration, writing or reflection only count when they are themselves the core subject of the LTO. Most courses contribute substantially to only a few of the programme's LTOs, so "false" is the usual answer. Give a one-sentence reason.

Stage 2 ("links"): only for courses where core_subject_addressed is true, link the statements that show it.

Rules for links:
1. Evidence comes only from the given statements. Cite them by id in "statement_ids". Never rely on what a course of this name would typically cover.
2. Link a statement only when its content is about the core subject of the LTO as explained in its title and narrative. A shared keyword, or a loosely related skill, is not enough. Prefer precision over recall: leave a link out when in doubt.
3. Determine the level from what students actually do in the statement (its verb and task), not from the wording of the LTO. Judge the cognitive, affective and psychomotor domains separately; most evidence is cognitive.
4. Levels are not cumulative: do not add lower levels just because a higher level is evidenced. Add a separate link for each level that has its own evidence.
5. A link concerns one course ("course_code"): never cite statements of different courses in the same link. Produce one link per course, domain and level, citing all statements that support it.
6. "justification": one or two sentences explaining why the cited statements show this level for this LTO. Refer to the statements, not to the course in general.
7. "confidence": between 0 and 1, how clearly the statements support the link.
8. The same objective often appears in several documents of a course (study guide, course manual). Cite every statement that expresses it.
9. Statements of kind "assessment", and learning goals with "assessed_by", show what is tested; activities and other learning goals show what is taught. Use them all as evidence in the same way; the distinction is made afterwards.`

/** Narratives may embed images; the model only needs the text. */
export function stripMarkdownImages(markdown: string): string {
  return markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim()
}

export function ltoText(lto: LinkingLto): string {
  const trajectoryNarrative = stripMarkdownImages(lto.trajectory.narrative)
  const narrative = stripMarkdownImages(lto.narrative)
  return [
    `# Trajectory: ${lto.trajectory.name}`,
    trajectoryNarrative,
    `# LTO ${lto.code}: ${lto.title}`,
    narrative,
  ]
    .filter((part) => part.length > 0)
    .join("\n\n")
}

function statementLine(s: LinkingStatement): string {
  const assessed = s.assessedBy.length > 0 ? ` | assessed_by: ${s.assessedBy.join(", ")}` : ""
  const context = s.context ? `${s.context} … ` : ""
  return `[${s.id}] (${s.kind}; ${DOCUMENT_KIND_LABELS[s.source].toLowerCase()}; section "${s.section}"${assessed}) ${context}${s.quote}`
}

export function linkingUserPrompt(lto: LinkingLto, courses: readonly LinkingCourse[]): string {
  const courseText = courses
    .map((c) => `## Course ${c.code}: ${c.name}\n${c.statements.map(statementLine).join("\n")}`)
    .join("\n\n")
  return `${ltoText(lto)}\n\n# Learning statements\n\n${courseText}`
}

/**
 * Keeps links that cite known statements and valid domain/level combinations. A link that cites
 * statements of several courses is split per course; duplicates are merged.
 */
export function sanitiseLinks(
  raw: z.infer<typeof linkingOutputSchema>,
  ltoId: number,
  courses: readonly LinkingCourse[],
): ProposedLink[] {
  const courseOf = new Map<number, number>()
  for (const course of courses) for (const s of course.statements) courseOf.set(s.id, course.key)
  // Links for courses the model itself judged not to address the LTO are discarded.
  const rejected = new Set(
    raw.courses
      .filter((c) => !c.core_subject_addressed)
      .map((c) => c.course_code.trim().toLowerCase()),
  )
  const merged = new Map<string, ProposedLink>()
  for (const link of raw.links) {
    const ref = parseBloomRef(link.domain, link.level)
    if (!ref || rejected.has(link.course_code.trim().toLowerCase())) continue
    const perCourse = new Map<number, number[]>()
    for (const id of new Set(link.statement_ids)) {
      const courseKey = courseOf.get(id)
      if (courseKey !== undefined)
        perCourse.set(courseKey, [...(perCourse.get(courseKey) ?? []), id])
    }
    for (const [courseKey, statementIds] of perCourse) {
      const key = `${courseKey}|${ref.domain}|${ref.level}`
      const existing = merged.get(key)
      if (existing) {
        existing.statementIds = [...new Set([...existing.statementIds, ...statementIds])]
        existing.confidence = Math.max(existing.confidence, link.confidence)
        continue
      }
      merged.set(key, {
        courseKey,
        ltoId,
        ref,
        statementIds,
        justification: link.justification.trim(),
        confidence: Math.min(1, Math.max(0, link.confidence)),
      })
    }
  }
  return [...merged.values()]
}

export async function linkLto(
  client: LlmClient,
  model: string,
  lto: LinkingLto,
  courses: readonly LinkingCourse[],
): Promise<{ links: ProposedLink[]; model: string }> {
  const withStatements = courses.filter((c) => c.statements.length > 0)
  if (withStatements.length === 0) return { links: [], model }
  const result = await client.generate({
    model,
    system: LINKING_SYSTEM_PROMPT,
    content: [{ type: "text", text: linkingUserPrompt(lto, withStatements) }],
    schema: linkingOutputSchema,
    schemaName: "lto_links",
  })
  return {
    links: sanitiseLinks(result.data, lto.id, withStatements),
    model: result.model,
  }
}
