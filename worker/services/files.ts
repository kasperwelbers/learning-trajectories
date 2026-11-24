/** R2 key layout: everything of a programme lives under `p/<programmeId>/`. */
export function documentKey(programmeId: string, courseId: number, filename: string): string {
  const safe = filename.replace(/[^\w.-]+/g, "_").slice(-100)
  return `p/${programmeId}/courses/${courseId}/${crypto.randomUUID()}-${safe}`
}

export function imageKey(programmeId: string, extension: string): string {
  return `p/${programmeId}/images/${crypto.randomUUID()}.${extension}`
}

/** Remove every object under a prefix (used when a programme is deleted). */
export async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined
  do {
    const page = await bucket.list(cursor ? { prefix, cursor } : { prefix })
    if (page.objects.length > 0) await bucket.delete(page.objects.map((o) => o.key))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
}

export const DOCUMENT_TYPES: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/html": "html",
}

/** Browsers are inconsistent about MIME types for .md/.docx; fall back to the extension. */
export function documentMimeType(file: File): string | null {
  if (file.type in DOCUMENT_TYPES) return file.type
  const extension = file.name.split(".").pop()?.toLowerCase()
  const match = Object.entries(DOCUMENT_TYPES).find(([, ext]) => ext === extension)
  return match ? match[0] : null
}

export const IMAGE_TYPES: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
}

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
