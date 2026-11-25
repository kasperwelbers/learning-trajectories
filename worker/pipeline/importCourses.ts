import { z } from "zod"
import type { ImportPreviewResponse, ProposedCourseDto } from "@shared/api"
import { aiConfig } from "../ai"
import { outboundFetch } from "../outbound"
import { htmlToText } from "./documentText"

/**
 * Populate a programme from existing web pages. Pages of the VU study guide are read through
 * its JSON API (exact, no AI). Any other page is reduced to text and the AI lists the courses
 * it describes. The result is a proposal that an admin confirms; nothing is created here.
 */

type Proposal = Omit<ProposedCourseDto, "exists">
interface SourceResult {
  url: string
  courses: Proposal[]
  error: string | null
}

// ── VU study guide ──────────────────────────────────────────────────────────

const VU_PROGRAMME_URL = /^https:\/\/studiegids\.vu\.nl\/(en|nl)\/(Bachelor|Master|Premaster|Postgraduate)\/(\d{4}-\d{4})\/([\w-]+)/i

interface VuModuleGroup {
  code: string
  type: string
  description: string
  courses: { code: string; name: string; credits: string; periods: { code: string }[] }[]
  moduleGroups: VuModuleGroup[]
}

const vuModuleGroup: z.ZodType<VuModuleGroup> = z.lazy(() =>
  z.object({
    code: z.string().catch(""),
    type: z.string().catch(""),
    description: z.string().catch(""),
    courses: z
      .array(
        z.object({
          code: z.string(),
          name: z.string(),
          credits: z.string().catch(""),
          periods: z.array(z.object({ code: z.string() })).catch([]),
        }),
      )
      .nullish()
      .transform((v) => v ?? []),
    moduleGroups: z
      .array(vuModuleGroup)
      .nullish()
      .transform((v) => v ?? []),
  }),
)

const vuStudy = z.object({ moduleGroups: z.array(vuModuleGroup) })

/** "P5+6" → [5, 6]; "P4" → [4]. */
export function parseVuPeriods(code: string): number[] {
  const match = /^P(\d+)(?:\+(\d+))?/i.exec(code.trim())
  if (!match) return []
  const first = Number(match[1])
  const last = match[2] ? Number(match[2]) : first
  return Array.from({ length: Math.max(0, last - first) + 1 }, (_, i) => first + i)
}

/** "First year bachelor" → 1. */
export function programmeYearFrom(text: string): number | null {
  const words: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, eerste: 1, tweede: 2, derde: 3 }
  const lower = text.toLowerCase()
  for (const [word, year] of Object.entries(words)) if (lower.includes(word)) return year
  const digit = /year\s*(\d)|jaar\s*(\d)/.exec(lower)
  return digit ? Number(digit[1] ?? digit[2]) : null
}

const ELECTIVE_TYPES = /minor|elective|free choice|vrije keuze|minorchoice/i

export function flattenVuCurriculum(groups: readonly VuModuleGroup[], lang: string, year: string): Proposal[] {
  const result: Proposal[] = []
  const visit = (group: VuModuleGroup, inheritedYear: number | null, elective: boolean, label: string) => {
    const ownYear = programmeYearFrom(group.description) ?? inheritedYear
    const isElective = elective || ELECTIVE_TYPES.test(group.type) || ELECTIVE_TYPES.test(group.description)
    const groupLabel = label ? `${label} › ${group.description}` : group.description
    for (const course of group.courses) {
      const credits = Number(course.credits)
      result.push({
        code: course.code,
        name: course.name,
        periods: [...new Set(course.periods.flatMap((p) => parseVuPeriods(p.code)))],
        ec: Number.isFinite(credits) && credits > 0 ? credits : null,
        level: null,
        programmeYear: ownYear,
        group: groupLabel,
        suggested: !isElective,
        url: `https://studiegids.vu.nl/${lang}/courses/${year}/${encodeURIComponent(course.code)}`,
      })
    }
    for (const child of group.moduleGroups) visit(child, ownYear, isElective, groupLabel)
  }
  for (const group of groups) visit(group, null, false, "")
  return result
}

async function fromVuStudyGuide(url: string, match: RegExpExecArray, fetchImpl: typeof fetch): Promise<SourceResult> {
  const [, lang = "en", type = "Bachelor", year = "", slug = ""] = match
  const api = `https://studiegids.vu.nl/api/studyguide/${lang.toUpperCase()}/${type}/${year}/studies/${slug}`
  const response = await fetchImpl(api, { headers: { Accept: "application/json" } })
  if (!response.ok) return { url, courses: [], error: `The study guide API returned HTTP ${response.status}` }
  const parsed = vuStudy.safeParse(await response.json())
  if (!parsed.success) return { url, courses: [], error: "Unexpected study guide data" }
  return { url, courses: flattenVuCurriculum(parsed.data.moduleGroups, lang.toLowerCase(), year), error: null }
}

// ── Any other web page (AI) ─────────────────────────────────────────────────

const MAX_PAGE_CHARS = 120_000

const importSchema = z.object({
  courses: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      periods: z.array(z.number().int()),
      ec: z.number().nullable(),
      level: z.number().nullable(),
      programme_year: z.number().int().nullable(),
      group: z.string(),
      elective: z.boolean(),
      url: z.string().nullable(),
    }),
  ),
})

const SYSTEM_PROMPT = `You read web pages of a university study programme (for example an online study guide) and list the courses of the programme.

For each course return:
- "code": the official course code exactly as written; skip courses without a code;
- "name": the course name;
- "periods": teaching periods as numbers ([] if unknown);
- "ec": credits (EC/ECTS), or null;
- "level": course level as a number (e.g. 100, 200, 300), or null;
- "programme_year": the year of the programme the course belongs to (1, 2, 3, ...), or null;
- "group": the heading the course is listed under (e.g. "Year 2", "Minor X"), or "";
- "elective": true for minors, free electives and courses from other programmes;
- "url": the link to the course's own page if the page lists one, else null.

Only list courses that appear on the pages. Do not invent courses or details. Each course once.`

async function fetchPageText(url: string, fetchImpl: typeof fetch): Promise<{ text: string | null; error: string | null }> {
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "text/html,text/plain", "User-Agent": "LearningTrajectories/1.0 (course import)" },
      redirect: "follow",
    })
    if (!response.ok) return { text: null, error: `HTTP ${response.status}` }
    const body = await response.text()
    const type = response.headers.get("Content-Type") ?? ""
    const text = type.includes("html") ? htmlWithLinks(body, url) : body
    if (text.trim().length < 50) {
      return { text: null, error: "The page has almost no text (it may need JavaScript to render)" }
    }
    return { text: text.slice(0, MAX_PAGE_CHARS), error: null }
  } catch (error) {
    return { text: null, error: error instanceof Error ? error.message : "Could not fetch the page" }
  }
}

/** Keep link targets in the text so the model can return course URLs. */
function htmlWithLinks(html: string, base: string): string {
  const withLinks = html.replace(/<a\s[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
    let absolute = href
    try {
      absolute = new URL(href, base).toString()
    } catch {
      // keep as is
    }
    return `${label} [${absolute}]`
  })
  return htmlToText(withLinks)
}

async function fromWebPage(env: Env, url: string): Promise<SourceResult> {
  const page = await fetchPageText(url, outboundFetch(env))
  if (page.text === null) return { url, courses: [], error: page.error }
  const { client, extractModel } = aiConfig(env)
  const result = await client.generate({
    model: extractModel,
    system: SYSTEM_PROMPT,
    content: [{ type: "text", text: `--- PAGE ${url} ---\n${page.text}` }],
    schema: importSchema,
    schemaName: "programme_courses",
  })
  return {
    url,
    error: null,
    courses: result.data.courses.map((c) => ({
      code: c.code,
      name: c.name,
      periods: c.periods,
      ec: c.ec,
      level: c.level,
      programmeYear: c.programme_year,
      group: c.group,
      suggested: !c.elective,
      url: c.url,
    })),
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────

export async function proposeCoursesFromUrls(env: Env, urls: string[]): Promise<ImportPreviewResponse> {
  const results = await Promise.all(
    urls.map(async (url): Promise<SourceResult> => {
      try {
        const vu = VU_PROGRAMME_URL.exec(url)
        return vu ? await fromVuStudyGuide(url, vu, outboundFetch(env)) : await fromWebPage(env, url)
      } catch (error) {
        return { url, courses: [], error: error instanceof Error ? error.message : "Import failed" }
      }
    }),
  )
  const seen = new Set<string>()
  const courses: ProposedCourseDto[] = []
  for (const course of results.flatMap((r) => r.courses)) {
    const code = course.code.trim()
    if (!code || seen.has(code.toLowerCase())) continue
    seen.add(code.toLowerCase())
    courses.push({ ...course, code, name: course.name.trim(), exists: false })
  }
  return {
    courses,
    sources: results.map((r) => ({ url: r.url, ok: r.error === null, error: r.error })),
  }
}
