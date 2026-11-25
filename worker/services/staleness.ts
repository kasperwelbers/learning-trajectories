import { inArray } from "drizzle-orm"
import type { Db } from "../db/client"
import { inChunks } from "../db/batching"
import { linkRuns } from "../db/schema"
import { documentsHashes, ltoHashes } from "./hashes"

interface AnalysisLike {
  id: number
  courseId: number
  year: string
  hasResults: boolean
  documentsHash: string | null
}

export interface Staleness {
  /** Documents changed since the analysis ran: the whole analysis should be redone. */
  documentsChanged(analysis: AnalysisLike): boolean
  /** LTO ids whose links for this analysis are outdated or missing. */
  staleLtos(analysis: AnalysisLike): number[]
  /** Either of the above. */
  isStale(analysis: AnalysisLike): boolean
}

/** Loads everything needed to judge staleness for a set of analyses in a few queries. */
export async function loadStaleness(
  db: Db,
  programmeId: string,
  analysisIds: readonly number[],
): Promise<Staleness> {
  const [hashes, docHashes, runs] = await Promise.all([
    ltoHashes(db, programmeId),
    documentsHashes(db, programmeId),
    inChunks(analysisIds, (chunk) => db.select().from(linkRuns).where(inArray(linkRuns.analysisId, chunk))),
  ])
  const runHash = new Map(runs.map((r) => [`${r.analysisId}|${r.ltoId}`, r.ltoHash]))
  const documentsChanged = (a: AnalysisLike) =>
    a.hasResults && a.documentsHash !== (docHashes.get(`${a.courseId}|${a.year}`) ?? null)
  const staleLtos = (a: AnalysisLike) =>
    a.hasResults ? [...hashes].filter(([ltoId, hash]) => runHash.get(`${a.id}|${ltoId}`) !== hash).map(([id]) => id) : []
  return {
    documentsChanged,
    staleLtos,
    isStale: (a) => documentsChanged(a) || staleLtos(a).length > 0,
  }
}
