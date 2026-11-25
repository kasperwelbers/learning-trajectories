import { z } from "zod"
import type { ImportPreviewResponse, ProposedCourseDto } from "@shared/api"
import { aiConfig } from "../ai"
import { htmlToText } from "./documentText"

/**
 * Populate a programme from existing web pages (e.g. the online study guide): fetch each URL,
 * reduce it to text and let the AI list the courses it describes. The result is a proposal that
 * an admin confirms; nothing is created here.
 */

const MAX_PAGE_CHARS = 120_000

const importSchema = z.object({
  courses: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      periods: z.array(z.number().int()),
      ec: z.number().nullable(),
      level: z.number().nullable(),
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
- "url": the link to the course's own page if the page lists one, else null.

Only list courses that appear on the pages. Do not invent courses or details. Each course once.`

async function fetchPage(url: string): Promise<{ url: string; text: string | null; error: string | null }> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html,text/plain", "User-Agent": "LearningTrajectories/1.0 (course import)" },
      redirect: "follow",
    })
    if (!response.ok) return { url, text: null, error: `HTTP ${response.status}` }
    const body = await response.text()
    const type = response.headers.get("Content-Type") ?? ""
    const text = type.includes("html") ? htmlWithLinks(body, url) : body
    if (text.trim().length < 50) {
      return { url, text: null, error: "The page has almost no text (it may need JavaScript to render)" }
    }
    return { url, text: text.slice(0, MAX_PAGE_CHARS), error: null }
  } catch (error) {
    return { url, text: null, error: error instanceof Error ? error.message : "Could not fetch the page" }
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

export async function proposeCoursesFromUrls(env: Env, urls: string[]): Promise<ImportPreviewResponse> {
  const pages = await Promise.all(urls.map(fetchPage))
  const sources = pages.map((p) => ({ url: p.url, ok: p.text !== null, error: p.error }))
  const usable = pages.filter((p): p is { url: string; text: string; error: null } => p.text !== null)
  if (usable.length === 0) return { courses: [], sources }

  const { client, extractModel } = aiConfig(env)
  const result = await client.generate({
    model: extractModel,
    system: SYSTEM_PROMPT,
    content: usable.map((p) => ({ type: "text" as const, text: `--- PAGE ${p.url} ---\n${p.text}` })),
    schema: importSchema,
    schemaName: "programme_courses",
  })
  const seen = new Set<string>()
  const courses: ProposedCourseDto[] = []
  for (const course of result.data.courses) {
    const code = course.code.trim()
    if (!code || seen.has(code.toLowerCase())) continue
    seen.add(code.toLowerCase())
    courses.push({ ...course, code, name: course.name.trim(), exists: false })
  }
  return { courses, sources }
}
