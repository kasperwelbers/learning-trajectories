import type { ImportPreviewResponse } from "@shared/api"

export async function proposeCoursesFromUrls(_env: Env, urls: string[]): Promise<ImportPreviewResponse> {
  return { courses: [], sources: urls.map((url) => ({ url, ok: false, error: "not implemented" })) }
}
