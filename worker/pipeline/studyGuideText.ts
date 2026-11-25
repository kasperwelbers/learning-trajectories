import { htmlToText } from "./documentText"

/** Fetching study guide pages; free of Worker bindings so scripts can use it too. */

export class StudyGuideError extends Error {}

export function studyGuideUrl(template: string, code: string, year: string): string {
  return template.replaceAll("{code}", encodeURIComponent(code)).replaceAll("{year}", year)
}

/** Keep the page's main content when it is marked up; drop navigation and footers. */
export function mainText(html: string): string {
  const main = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? html
  return htmlToText(main.replace(/<(header|nav|footer|aside)[\s\S]*?<\/\1>/gi, " "))
}

export async function fetchStudyGuideText(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "text/html", "User-Agent": "LearningTrajectories/1.0 (study guide)" },
      redirect: "follow",
    })
  } catch {
    throw new StudyGuideError(`Could not reach ${url}`)
  }
  if (!response.ok) throw new StudyGuideError(`The study guide page returned HTTP ${response.status}`)
  const text = mainText(await response.text())
  if (text.length < 200) throw new StudyGuideError("The study guide page has almost no text (it may need JavaScript)")
  return text
}
