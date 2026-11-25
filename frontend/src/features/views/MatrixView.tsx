import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { MessageSquareWarning } from "lucide-react"
import { useMemo, useState } from "react"
import { BLOOM_DOMAINS } from "@shared/bloom"
import { coveredDomains, flowerFromLinks, groupBy, type FlowerCoverage } from "@shared/coverage"
import { queries } from "@/api/queries"
import { Flower } from "@/components/bloom/Flower"
import { Loading, QueryError } from "@/components/layout/ErrorView"
import { useCoverage } from "@/hooks/useCoverage"
import { useProgramme } from "@/hooks/useProgramme"
import { compareCourses, courseYear } from "@/lib/curriculum"
import { formatPeriods } from "@/lib/format"
import { FilterToggle, ViewHeader } from "./ViewHeader"

export function MatrixView() {
  const { programme } = useProgramme()
  const structure = useQuery(queries.structure(programme.id))
  const coverage = useCoverage()
  const [studyGuideOnly, setStudyGuideOnly] = useState(false)

  const cellFlowers = useMemo(() => {
    const links = (coverage.data?.links ?? []).filter((l) => !studyGuideOnly || l.inStudyGuide)
    const grouped = groupBy(links, (l) => `${l.courseId}|${l.ltoId}`)
    return new Map([...grouped].map(([key, list]) => [key, flowerFromLinks(list)]))
  }, [coverage.data, studyGuideOnly])

  const courses = useMemo(() => [...(coverage.data?.courses ?? [])].filter((c) => c.analysisYear).sort(compareCourses), [coverage.data])
  const ltos = structure.data?.trajectories.flatMap((t) => t.ltos.map((lto) => ({ lto, trajectory: t }))) ?? []

  return (
    <div className="space-y-6">
      <ViewHeader
        title="Course × LTO matrix"
        description="What each course contributes to each outcome. Each cell shows the Bloom flowers of that course for that LTO; hover a petal for the level."
      >
        <FilterToggle checked={studyGuideOnly} onChange={setStudyGuideOnly}>
          Only evidence that is explicit in the study guide
        </FilterToggle>
      </ViewHeader>
      {(structure.error ?? coverage.error) && <QueryError error={structure.error ?? coverage.error} />}
      {(!structure.data || !coverage.data) && !structure.error && !coverage.error && <Loading />}
      {structure.data && coverage.data && courses.length === 0 && (
        <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">No analysed courses yet.</p>
      )}
      {structure.data && coverage.data && courses.length > 0 && (
        <div className="max-h-[80vh] overflow-auto rounded-xl border bg-card">
          <table className="border-separate border-spacing-0 text-xs">
            <thead className="sticky top-0 z-10 bg-card">
              <tr>
                <th className="sticky left-0 z-20 bg-card" />
                {structure.data.trajectories.map((t) =>
                  t.ltos.length ? (
                    <th key={t.id} colSpan={t.ltos.length} className="border-b px-1 py-1.5 text-left font-medium">
                      <span className="block truncate border-t-4 pt-1" style={{ borderColor: t.color || "var(--primary)", maxWidth: `${t.ltos.length * 3}rem` }} title={t.name}>
                        {t.name}
                      </span>
                    </th>
                  ) : null,
                )}
              </tr>
              <tr>
                <th className="sticky left-0 z-20 border-b bg-card px-3 py-2 text-left font-medium">Course</th>
                {ltos.map(({ lto }) => (
                  <th key={lto.id} className="w-12 border-b px-1 py-2 font-mono font-normal text-muted-foreground">
                    <Link
                      to="/p/$programmeId/ltos/$ltoId"
                      params={{ programmeId: programme.id, ltoId: String(lto.id) }}
                      search={(s) => ({ year: s.year })}
                      className="hover:underline"
                      title={lto.title}
                    >
                      {lto.code}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {courses.map((course) => (
                <tr key={course.id} className="hover:bg-muted/40">
                  <th className="sticky left-0 z-10 max-w-72 border-b bg-card px-3 py-1.5 text-left font-normal">
                    <Link
                      to="/p/$programmeId/courses/$courseId"
                      params={{ programmeId: programme.id, courseId: String(course.id) }}
                      search={(s) => ({ year: s.year })}
                      className="block truncate hover:underline"
                      title={course.name}
                    >
                      <span className="mr-1.5 font-mono text-muted-foreground">{course.code}</span>
                      {course.name}
                    </Link>
                    <span className="text-[0.7rem] text-muted-foreground">
                      {courseYear(course) ? `Y${courseYear(course)} · ` : ""}
                      {formatPeriods(course.periods)}
                    </span>
                  </th>
                  {ltos.map(({ lto }) => {
                    const flower = cellFlowers.get(`${course.id}|${lto.id}`)
                    const disputed = coverage.data?.disputed.has(`${course.id}|${lto.id}`)
                    return (
                      <td key={lto.id} className="border-b px-1 py-1 text-center">
                        {flower && <MiniFlowers coverage={flower} />}
                        {disputed && (
                          <span title="Disputed by the course coordinator">
                            <MessageSquareWarning className="mx-auto size-3 text-warning" />
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function MiniFlowers({ coverage }: { coverage: FlowerCoverage }) {
  const domains = coveredDomains(coverage)
  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      {BLOOM_DOMAINS.filter((d) => domains.includes(d)).map((d) => (
        <Flower key={d} domain={d} coverage={coverage} size={18} />
      ))}
    </span>
  )
}
