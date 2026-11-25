import { and, eq } from "drizzle-orm"
import { sha256Hex } from "../auth/crypto"
import type { Db } from "../db/client"
import { documents } from "../db/schema"
import { invalid } from "../errors"
import { StudyGuideError, fetchStudyGuideText } from "../pipeline/studyGuideText"
import { outboundFetch } from "../outbound"
import { documentKey } from "./files"

export { studyGuideUrl } from "../pipeline/studyGuideText"

/**
 * Study guide pages are fetched by URL and stored as plain text. The document hash is taken over
 * the text, so re-fetching an unchanged page (whose HTML may differ in tokens or ads) does not
 * trigger a new extraction.
 */
/**
 * Fetch and store the study guide page of a course for a year, replacing an earlier one.
 * Returns false when the content did not change.
 */
export async function saveStudyGuide(
  env: Env,
  db: Db,
  input: {
    programmeId: string
    course: { id: number; code: string }
    year: string
    url: string
    uploadedBy: string
  },
): Promise<boolean> {
  let text: string
  try {
    text = await fetchStudyGuideText(input.url, outboundFetch(env))
  } catch (error) {
    if (error instanceof StudyGuideError) throw invalid(error.message)
    throw error
  }
  const bytes = new TextEncoder().encode(text)
  const sha256 = await sha256Hex(bytes)
  const existing = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.courseId, input.course.id),
        eq(documents.year, input.year),
        eq(documents.kind, "study_guide"),
      ),
    )
  if (existing.some((d) => d.sha256 === sha256 && d.sourceUrl === input.url)) return false

  const filename = `${input.course.code} study guide ${input.year}.txt`
  const key = documentKey(input.programmeId, input.course.id, filename)
  await env.FILES.put(key, bytes, {
    httpMetadata: { contentType: "text/plain; charset=utf-8" },
  })
  await db.insert(documents).values({
    programmeId: input.programmeId,
    courseId: input.course.id,
    year: input.year,
    kind: "study_guide",
    filename,
    mimeType: "text/plain",
    size: bytes.byteLength,
    sha256,
    r2Key: key,
    sourceUrl: input.url,
    uploadedBy: input.uploadedBy,
  })
  for (const old of existing) {
    await db.delete(documents).where(eq(documents.id, old.id))
    await env.FILES.delete(old.r2Key)
  }
  return true
}
