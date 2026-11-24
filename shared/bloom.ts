import { z } from "zod"

/**
 * Bloom's taxonomy in three domains. Levels are ordered from low to high.
 *
 * Descriptions are shown in the UI and given verbatim to the AI, so they are written to be
 * unambiguous about what counts as evidence for a level.
 */

export const BLOOM_DOMAINS = ["cognitive", "affective", "psychomotor"] as const
export type BloomDomain = (typeof BLOOM_DOMAINS)[number]

interface LevelText {
  readonly label: string
  readonly description: string
  readonly verbs: readonly string[]
}

export interface BloomLevelInfo<K extends string = string> extends LevelText {
  readonly key: K
}

const COGNITIVE = ["remember", "understand", "apply", "analyse", "evaluate", "create"] as const

const COGNITIVE_INFO: Record<(typeof COGNITIVE)[number], LevelText> = {
  remember: {
    label: "Remember",
    description: "Recall or recognise facts, terms and basic concepts.",
    verbs: ["define", "list", "name", "recall", "recognise", "state"],
  },
  understand: {
    label: "Understand",
    description:
      "Explain ideas or concepts in one's own words; interpret, summarise, classify, compare.",
    verbs: ["explain", "describe", "summarise", "classify", "interpret", "distinguish"],
  },
  apply: {
    label: "Apply",
    description: "Use information, methods or procedures in a new, concrete situation.",
    verbs: ["apply", "use", "carry out", "implement", "calculate", "perform"],
  },
  analyse: {
    label: "Analyse",
    description:
      "Break material into parts and determine how they relate to each other and to an overall structure.",
    verbs: ["analyse", "differentiate", "organise", "deconstruct", "examine", "relate"],
  },
  evaluate: {
    label: "Evaluate",
    description: "Justify a stand or decision; make judgements based on criteria and standards.",
    verbs: ["evaluate", "critique", "assess", "justify", "argue", "reflect on"],
  },
  create: {
    label: "Create",
    description:
      "Put elements together into a coherent new whole; produce original work such as a design, plan or research report.",
    verbs: ["design", "construct", "develop", "formulate", "produce", "write"],
  },
}

const AFFECTIVE = ["receiving", "responding", "valuing", "organising", "characterising"] as const

const AFFECTIVE_INFO: Record<(typeof AFFECTIVE)[number], LevelText> = {
  receiving: {
    label: "Receiving",
    description: "Awareness of and willingness to attend to ideas, values or phenomena.",
    verbs: ["attend to", "be aware of", "listen", "acknowledge"],
  },
  responding: {
    label: "Responding",
    description: "Active participation; reacting to and engaging with a phenomenon.",
    verbs: ["participate", "discuss", "respond", "contribute", "comply"],
  },
  valuing: {
    label: "Valuing",
    description:
      "Attaching worth to an idea, value or behaviour and showing commitment to it, e.g. to academic integrity.",
    verbs: ["commit to", "value", "appreciate", "show willingness", "advocate"],
  },
  organising: {
    label: "Organising",
    description:
      "Integrating different values, resolving conflicts between them and building a consistent value system; reflecting on one's own role.",
    verbs: ["integrate", "prioritise", "reconcile", "formulate a position", "reflect on own role"],
  },
  characterising: {
    label: "Characterising",
    description:
      "Having a value system that consistently controls behaviour; acting as a professional who embodies these values.",
    verbs: ["act consistently", "embody", "display", "demonstrate professionally"],
  },
}

const PSYCHOMOTOR = ["imitation", "manipulation", "precision", "articulation", "naturalisation"] as const

const PSYCHOMOTOR_INFO: Record<(typeof PSYCHOMOTOR)[number], LevelText> = {
  imitation: {
    label: "Imitation",
    description: "Observe and copy the actions of others under guidance.",
    verbs: ["copy", "follow", "replicate", "repeat"],
  },
  manipulation: {
    label: "Manipulation",
    description: "Perform actions by following instructions and practising.",
    verbs: ["perform by instruction", "practise", "execute", "operate"],
  },
  precision: {
    label: "Precision",
    description: "Perform a skill accurately and independently, with few errors.",
    verbs: ["perform accurately", "calibrate", "demonstrate", "master"],
  },
  articulation: {
    label: "Articulation",
    description: "Coordinate and adapt a series of skills to meet new requirements.",
    verbs: ["adapt", "combine", "coordinate", "integrate skills"],
  },
  naturalisation: {
    label: "Naturalisation",
    description: "Perform skills automatically and with ease; design new procedures.",
    verbs: ["perform automatically", "design new procedures", "invent", "manage"],
  },
}

const LEVEL_KEYS = {
  cognitive: COGNITIVE,
  affective: AFFECTIVE,
  psychomotor: PSYCHOMOTOR,
} as const

export type BloomLevel<D extends BloomDomain = BloomDomain> = (typeof LEVEL_KEYS)[D][number]

/** A specific level within a specific domain. */
export type BloomRef = {
  [D in BloomDomain]: { domain: D; level: BloomLevel<D> }
}[BloomDomain]

export interface BloomDomainInfo<D extends BloomDomain = BloomDomain> {
  readonly key: D
  readonly label: string
  readonly source: string
  readonly description: string
  readonly levels: readonly BloomLevelInfo<BloomLevel<D>>[]
}

function withInfo<K extends string>(
  keys: readonly K[],
  info: Record<K, LevelText>,
): readonly BloomLevelInfo<K>[] {
  return keys.map((key) => ({ key, ...info[key] }))
}

export const BLOOM: { readonly [D in BloomDomain]: BloomDomainInfo<D> } = {
  cognitive: {
    key: "cognitive",
    label: "Cognitive",
    source: "Anderson & Krathwohl (2001)",
    description: "Knowledge and intellectual skills.",
    levels: withInfo(COGNITIVE, COGNITIVE_INFO),
  },
  affective: {
    key: "affective",
    label: "Affective",
    source: "Krathwohl, Bloom & Masia (1964)",
    description: "Attitudes, values and professional dispositions.",
    levels: withInfo(AFFECTIVE, AFFECTIVE_INFO),
  },
  psychomotor: {
    key: "psychomotor",
    label: "Psychomotor",
    source: "Dave (1970)",
    description: "Practical, physical and technical skills.",
    levels: withInfo(PSYCHOMOTOR, PSYCHOMOTOR_INFO),
  },
}

export function levelsOf<D extends BloomDomain>(domain: D): readonly BloomLevel<D>[] {
  return LEVEL_KEYS[domain]
}

export function levelInfo(ref: BloomRef): BloomLevelInfo {
  const levels: readonly BloomLevelInfo[] = BLOOM[ref.domain].levels
  const info = levels.find((l) => l.key === ref.level)
  if (!info) throw new Error(`Unknown Bloom level ${ref.domain}/${ref.level}`)
  return info
}

/** 0-based position of a level within its domain. */
export function levelIndex(ref: BloomRef): number {
  const levels: readonly string[] = LEVEL_KEYS[ref.domain]
  return levels.indexOf(ref.level)
}

export const bloomDomainSchema = z.enum(BLOOM_DOMAINS)

export const bloomRefSchema = z.discriminatedUnion("domain", [
  z.object({ domain: z.literal("cognitive"), level: z.enum(COGNITIVE) }),
  z.object({ domain: z.literal("affective"), level: z.enum(AFFECTIVE) }),
  z.object({ domain: z.literal("psychomotor"), level: z.enum(PSYCHOMOTOR) }),
])

/** Parse untrusted (e.g. database) values; throws on invalid input. */
export function toBloomRef(domain: string, level: string): BloomRef {
  return bloomRefSchema.parse({ domain, level })
}

export function parseBloomRef(domain: string, level: string): BloomRef | null {
  const result = bloomRefSchema.safeParse({ domain, level })
  return result.success ? result.data : null
}

export function bloomRefKey(ref: BloomRef): string {
  return `${ref.domain}:${ref.level}`
}

/** Every domain/level combination, in canonical order. */
export const ALL_BLOOM_REFS: readonly BloomRef[] = BLOOM_DOMAINS.flatMap((domain) =>
  levelsOf(domain).map((level) => toBloomRef(domain, level)),
)

/** A plain `{ domain, level }` copy of anything carrying a Bloom reference. */
export function refOf(ref: BloomRef): BloomRef {
  switch (ref.domain) {
    case "cognitive":
      return { domain: ref.domain, level: ref.level }
    case "affective":
      return { domain: ref.domain, level: ref.level }
    case "psychomotor":
      return { domain: ref.domain, level: ref.level }
  }
}
