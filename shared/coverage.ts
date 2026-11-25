import {
  BLOOM_DOMAINS,
  bloomRefKey,
  levelsOf,
  type BloomDomain,
  type BloomLevel,
  type BloomRef,
} from "./bloom"
import type { LinkOrigin } from "./evidence"

/** How strongly a Bloom level is covered. */
export type CoverageState = "tested" | "taught"

/** One course covering one LTO at one Bloom level. */
export type CoverageLink = BloomRef & {
  courseId: number
  ltoId: number
  tested: boolean
  origin: LinkOrigin
  /** Whether the evidence includes the public course description (study guide). */
  inStudyGuide: boolean
}

export type DomainCoverage<D extends BloomDomain = BloomDomain> = Partial<
  Record<BloomLevel<D>, CoverageState>
>

export type FlowerCoverage = { [D in BloomDomain]: DomainCoverage<D> }

export function emptyFlower(): FlowerCoverage {
  return { cognitive: {}, affective: {}, psychomotor: {} }
}

export function strongest(
  a: CoverageState | undefined,
  b: CoverageState | undefined,
): CoverageState | undefined {
  if (a === "tested" || b === "tested") return "tested"
  return a ?? b
}

export function coverageAt(flower: FlowerCoverage, ref: BloomRef): CoverageState | undefined {
  const domain: Partial<Record<string, CoverageState>> = flower[ref.domain]
  return domain[ref.level]
}

function setCoverage(flower: FlowerCoverage, ref: BloomRef, state: CoverageState): void {
  const domain: Partial<Record<string, CoverageState>> = flower[ref.domain]
  domain[ref.level] = strongest(domain[ref.level], state)
}

/** Combine links (from any number of courses) into one flower. */
export function flowerFromLinks(links: Iterable<BloomRef & { tested: boolean }>): FlowerCoverage {
  const flower = emptyFlower()
  for (const link of links) setCoverage(flower, link, link.tested ? "tested" : "taught")
  return flower
}

/** Flower per LTO id. */
export function flowersByLto(links: Iterable<CoverageLink>): Map<number, FlowerCoverage> {
  const grouped = groupBy(links, (l) => l.ltoId)
  const result = new Map<number, FlowerCoverage>()
  for (const [ltoId, ltoLinks] of grouped) result.set(ltoId, flowerFromLinks(ltoLinks))
  return result
}

export function coveredDomains(flower: FlowerCoverage): BloomDomain[] {
  return BLOOM_DOMAINS.filter((d) => Object.keys(flower[d]).length > 0)
}

/** Highest covered level per domain (index), or -1. Used for compact summaries. */
export function highestLevelIndex(flower: FlowerCoverage, domain: BloomDomain): number {
  const levels: readonly string[] = levelsOf(domain)
  const covered: Partial<Record<string, CoverageState>> = flower[domain]
  let highest = -1
  levels.forEach((level, i) => {
    if (covered[level]) highest = i
  })
  return highest
}

export interface CellCourses {
  taught: number[]
  tested: number[]
}

/** For each LTO and Bloom level: which courses teach (only) and which test it. */
export function heatmapCells(links: Iterable<CoverageLink>): Map<string, CellCourses> {
  const perCourse = new Map<string, Map<number, CoverageState>>()
  for (const link of links) {
    const key = heatmapKey(link.ltoId, link)
    const courses = perCourse.get(key) ?? new Map<number, CoverageState>()
    const state: CoverageState = link.tested ? "tested" : "taught"
    courses.set(link.courseId, strongest(courses.get(link.courseId), state) ?? state)
    perCourse.set(key, courses)
  }
  const cells = new Map<string, CellCourses>()
  for (const [key, courses] of perCourse) {
    const cell: CellCourses = { taught: [], tested: [] }
    for (const [courseId, state] of courses) cell[state].push(courseId)
    cells.set(key, cell)
  }
  return cells
}

export function heatmapKey(ltoId: number, ref: BloomRef): string {
  return `${ltoId}|${bloomRefKey(ref)}`
}

export function groupBy<T, K>(items: Iterable<T>, keyOf: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const list = map.get(key)
    if (list) list.push(item)
    else map.set(key, [item])
  }
  return map
}
