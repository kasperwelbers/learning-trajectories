import { and, eq, inArray } from "drizzle-orm"
import { Hono } from "hono"
import {
  yearQuerySchema,
  type CoverageResponse,
  type EvidenceLinkDto,
  type EvidenceStatementDto,
  type LtoEvidenceResponse,
  type MetadataTableResponse,
} from "@shared/api"
import { BLOOM_DOMAINS, bloomRefKey, levelIndex, refOf } from "@shared/bloom"
import type { CoverageLink } from "@shared/coverage"
import type { ProgrammeEnv } from "../context"
import { inChunks } from "../db/batching"
import { analysisFields, disputes, documents, links, ltos, statements } from "../db/schema"
import { found } from "../errors"
import { loadLinkDtos, metadataValues } from "../services/analysisDetail"
import { courseFacts, coursesWithAnalyses } from "../services/courseFacts"
import { intParam, validate } from "../validation"
import { toDisputeDto } from "./feedback"
import { loadFields } from "./frameworks"

export const viewRoutes = new Hono<ProgrammeEnv>()

/** All links of every course's effective analysis: the data behind flowers, heatmap and matrix. */
viewRoutes.get("/coverage", validate("query", yearQuerySchema), async (c) => {
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  const { year } = c.req.valid("query")
  const items = await coursesWithAnalyses(db, programmeId, year)
  const courseByAnalysis = new Map(
    items.flatMap((i) => (i.effective ? [[i.effective.id, i.course.id] as const] : [])),
  )
  const [facts, linkRows, disputeRows] = await Promise.all([
    courseFacts(db, items),
    inChunks([...courseByAnalysis.keys()], (chunk) =>
      db.select().from(links).where(inArray(links.analysisId, chunk)),
    ),
    db
      .select({
        courseId: disputes.courseId,
        ltoId: disputes.ltoId,
        year: disputes.year,
      })
      .from(disputes)
      .where(and(eq(disputes.programmeId, programmeId), eq(disputes.status, "open"))),
  ])
  const linkDtos = await loadLinkDtos(db, linkRows)
  const analysisOfLink = new Map(linkRows.map((r) => [r.id, r.analysisId]))
  const coverage: CoverageLink[] = linkDtos.flatMap((link) => {
    const courseId = courseByAnalysis.get(analysisOfLink.get(link.id) ?? -1)
    if (courseId === undefined) return []
    return [
      {
        ...refOf(link),
        courseId,
        ltoId: link.ltoId,
        tested: link.tested,
        origin: link.origin,
        inStudyGuide: link.sources.includes("study_guide"),
      },
    ]
  })
  const effectiveYear = new Map(items.map((i) => [i.course.id, i.effective?.year]))
  const disputedPairs = [
    ...new Set(
      disputeRows
        .filter((d) => effectiveYear.get(d.courseId) === d.year)
        .map((d) => `${d.courseId}|${d.ltoId}`),
    ),
  ]
  return c.json<CoverageResponse>({
    year,
    courses: facts,
    links: coverage,
    disputedPairs,
  })
})

/** Everything behind one LTO's flowers: per course and level the quotes and justifications. */
viewRoutes.get("/ltos/:lid/evidence", validate("query", yearQuerySchema), async (c) => {
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  const { year } = c.req.valid("query")
  const ltoId = intParam(c.req.param("lid"))
  found(
    await db
      .select({ id: ltos.id })
      .from(ltos)
      .where(and(eq(ltos.id, ltoId), eq(ltos.programmeId, programmeId)))
      .get(),
    "LTO not found",
  )
  const items = await coursesWithAnalyses(db, programmeId, year)
  const effectiveIds = items.flatMap((i) => (i.effective ? [i.effective.id] : []))
  const [facts, linkRows, disputeRows] = await Promise.all([
    courseFacts(db, items),
    inChunks(effectiveIds, (chunk) =>
      db
        .select()
        .from(links)
        .where(and(eq(links.ltoId, ltoId), inArray(links.analysisId, chunk))),
    ),
    db
      .select()
      .from(disputes)
      .where(and(eq(disputes.programmeId, programmeId), eq(disputes.ltoId, ltoId))),
  ])
  const linkDtos = await loadLinkDtos(db, linkRows)
  const analysisOfLink = new Map(linkRows.map((r) => [r.id, r.analysisId]))
  const statementIds = [...new Set(linkDtos.flatMap((l) => l.statementIds))]
  const statementRows = await inChunks(statementIds, (chunk) =>
    db
      .select({
        statement: statements,
        document: {
          id: documents.id,
          kind: documents.kind,
          filename: documents.filename,
        },
      })
      .from(statements)
      .innerJoin(documents, eq(documents.id, statements.documentId))
      .where(inArray(statements.id, chunk)),
  )
  const statementById = new Map<number, EvidenceStatementDto>(
    statementRows.map(({ statement: s, document }) => [
      s.id,
      {
        id: s.id,
        kind: s.kind,
        section: s.section,
        context: s.context,
        quote: s.quote,
        page: s.page,
        verification: s.verification,
        assessedBy: s.assessedBy,
        document,
      },
    ]),
  )

  const response: LtoEvidenceResponse = { ltoId, year, courses: [] }
  items.forEach((item, i) => {
    const fact = facts[i]
    if (!item.effective || !fact) return
    const analysisId = item.effective.id
    const courseLinks = linkDtos.filter((l) => analysisOfLink.get(l.id) === analysisId)
    const courseDisputes = disputeRows
      .filter((d) => d.courseId === item.course.id && d.year === item.effective?.year)
      .flatMap(toDisputeDto)
    if (courseLinks.length === 0 && courseDisputes.length === 0) return
    const levels = new Map<string, LtoEvidenceResponse["courses"][number]["levels"][number]>()
    for (const link of courseLinks) {
      const key = bloomRefKey(link)
      const evidence: EvidenceLinkDto = {
        justification: link.justification,
        confidence: link.confidence,
        origin: link.origin,
        tested: link.tested,
        sources: link.sources,
        statements: link.statementIds.flatMap((id) => {
          const s = statementById.get(id)
          return s ? [s] : []
        }),
      }
      const existing = levels.get(key)
      if (existing) {
        existing.links.push(evidence)
        existing.tested ||= link.tested
      } else {
        levels.set(key, {
          ...refOf(link),
          tested: link.tested,
          links: [evidence],
        })
      }
    }
    const sorted = [...levels.values()].sort(
      (a, b) =>
        BLOOM_DOMAINS.indexOf(a.domain) - BLOOM_DOMAINS.indexOf(b.domain) ||
        levelIndex(a) - levelIndex(b),
    )
    response.courses.push({
      course: fact,
      levels: sorted,
      disputes: courseDisputes,
    })
  })
  return c.json(response)
})

/** Courses × extraction fields, for checking consistency across manuals. */
viewRoutes.get("/metadata", validate("query", yearQuerySchema), async (c) => {
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  const { year } = c.req.valid("query")
  const items = await coursesWithAnalyses(db, programmeId, year)
  const effectiveIds = items.flatMap((i) => (i.effective ? [i.effective.id] : []))
  const [facts, fields, fieldRows] = await Promise.all([
    courseFacts(db, items),
    loadFields(db, programmeId),
    inChunks(effectiveIds, (chunk) =>
      db.select().from(analysisFields).where(inArray(analysisFields.analysisId, chunk)),
    ),
  ])
  const rows: MetadataTableResponse["rows"] = items.flatMap((item, i) => {
    const fact = facts[i]
    if (!fact) return []
    const effective = item.effective
    if (!effective) return [{ course: fact, values: {} }]
    const values = metadataValues(
      fields,
      fieldRows.filter((r) => r.analysisId === effective.id),
    )
    return [
      {
        course: fact,
        values: Object.fromEntries(values.map((v) => [v.key, v])),
      },
    ]
  })
  return c.json<MetadataTableResponse>({ year, fields, rows })
})
