import { useQuery } from "@tanstack/react-query"
import { Printer } from "lucide-react"
import { useMemo, useState } from "react"
import type { FrameworkDto, JustificationDto, LtoDto, TrajectoryDto } from "@shared/api"
import { ALL_BLOOM_REFS } from "@shared/bloom"
import { coverageAt, flowerFromLinks, groupBy } from "@shared/coverage"
import { queries } from "@/api/queries"
import { FlowerLegend, FlowerRow } from "@/components/bloom/Flower"
import { LevelBadge } from "@/components/evidence/Badges"
import { Loading, QueryError } from "@/components/layout/ErrorView"
import { MarkdownView } from "@/components/markdown/MarkdownView"
import { Button } from "@/components/ui/button"
import { useCoverage, type CoverageData } from "@/hooks/useCoverage"
import { useProgramme } from "@/hooks/useProgramme"
import { compareCourses } from "@/lib/curriculum"
import { formatDate } from "@/lib/format"

/** A printable report of the whole programme, for visitation committees. */
export function ReportView() {
  const { programme, year } = useProgramme()
  const structure = useQuery(queries.structure(programme.id))
  const frameworks = useQuery(queries.frameworks(programme.id))
  const justifications = useQuery(queries.justifications(programme.id))
  const coverage = useCoverage()
  const [generatedAt] = useState(() => Date.now())
  const error = structure.error ?? frameworks.error ?? justifications.error ?? coverage.error
  if (error) return <QueryError error={error} />
  const coverageData = coverage.data
  if (!structure.data || !frameworks.data || !justifications.data || !coverageData) return <Loading />

  return (
    <article className="mx-auto max-w-4xl space-y-12 print:max-w-none">
      <header className="space-y-3 border-b pb-8">
        <div className="no-print flex justify-end">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer /> Print or save as PDF
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Programme report · academic year {year} · generated {formatDate(generatedAt)}
        </p>
        <h1 className="text-4xl font-semibold">{programme.name}</h1>
        <MarkdownView markdown={programme.description} />
        <Summary trajectories={structure.data.trajectories} coverage={coverageData} />
        <FlowerLegend />
      </header>
      {structure.data.trajectories.map((t) => (
        <TrajectorySection key={t.id} trajectory={t} coverage={coverageData} frameworks={frameworks.data} justifications={justifications.data} />
      ))}
    </article>
  )
}

function Summary({ trajectories, coverage }: { trajectories: TrajectoryDto[]; coverage: CoverageData }) {
  const ltos = trajectories.flatMap((t) => t.ltos)
  const covered = ltos.filter((l) => coverage.flowers.has(l.id)).length
  const tested = ltos.filter((l) => coverage.links.some((x) => x.ltoId === l.id && x.tested)).length
  const analysed = coverage.courses.filter((c) => c.analysisYear).length
  return (
    <dl className="grid grid-cols-2 gap-4 py-2 sm:grid-cols-4">
      <Figure label="Trajectories" value={trajectories.length} />
      <Figure label="LTOs with evidence" value={`${covered} / ${ltos.length}`} />
      <Figure label="LTOs tested somewhere" value={`${tested} / ${ltos.length}`} />
      <Figure label="Courses analysed" value={`${analysed} / ${coverage.courses.length}`} />
    </dl>
  )
}

function Figure({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold">{value}</dd>
    </div>
  )
}

function TrajectorySection({
  trajectory,
  coverage,
  frameworks,
  justifications,
}: {
  trajectory: TrajectoryDto
  coverage: CoverageData
  frameworks: FrameworkDto[]
  justifications: JustificationDto[]
}) {
  return (
    <section className="space-y-6 break-before-page">
      <div className="space-y-3">
        <h2 className="border-l-4 pl-3 text-3xl font-semibold" style={{ borderColor: trajectory.color || "var(--primary)" }}>
          {trajectory.name}
        </h2>
        <MarkdownView markdown={trajectory.narrative} empty="No narrative." />
      </div>
      {trajectory.ltos.map((lto) => (
        <LtoSection key={lto.id} lto={lto} coverage={coverage} frameworks={frameworks} justifications={justifications} />
      ))}
    </section>
  )
}

function LtoSection({
  lto,
  coverage,
  frameworks,
  justifications,
}: {
  lto: LtoDto
  coverage: CoverageData
  frameworks: FrameworkDto[]
  justifications: JustificationDto[]
}) {
  const courses = useMemo(() => {
    const byCourse = groupBy(coverage.links.filter((l) => l.ltoId === lto.id), (l) => l.courseId)
    return [...byCourse.entries()]
      .flatMap(([courseId, links]) => {
        const course = coverage.courseById.get(courseId)
        return course ? [{ course, links }] : []
      })
      .sort((a, b) => compareCourses(a.course, b.course))
  }, [coverage, lto.id])
  const written = frameworks.flatMap((f) =>
    f.indicators.flatMap((i) => {
      const j = justifications.find((x) => x.ltoId === lto.id && x.indicatorId === i.id && x.text.trim())
      return j ? [{ framework: f, indicator: i, text: j.text }] : []
    }),
  )

  return (
    <div className="space-y-4 rounded-xl border bg-card p-6 break-inside-avoid print:border-0 print:p-0">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{lto.code}</p>
          <h3 className="text-xl leading-snug font-semibold">{lto.title}</h3>
        </div>
        <FlowerRow coverage={coverage.flowers.get(lto.id)} size={44} labels />
      </div>
      <MarkdownView markdown={lto.narrative} className="text-sm" />
      {written.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Justification</h4>
          {written.map(({ framework, indicator, text }) => (
            <div key={indicator.id} className="text-sm">
              <p className="font-medium">
                {framework.name} · {indicator.name}
              </p>
              <MarkdownView markdown={text} className="text-sm" />
            </div>
          ))}
        </div>
      )}
      <div>
        <h4 className="mb-2 text-sm font-semibold">Contributing courses</h4>
        {courses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No course provides evidence yet.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {courses.map(({ course, links }) => {
                const flower = flowerFromLinks(links)
                const levels = ALL_BLOOM_REFS.filter((ref) => coverageAt(flower, ref) !== undefined)
                return (
                  <tr key={course.id} className="border-t align-top">
                    <td className="py-1.5 pr-3">
                      <span className="mr-2 font-mono text-xs text-muted-foreground">{course.code}</span>
                      {course.name}
                    </td>
                    <td className="py-1.5">
                      <span className="flex flex-wrap justify-end gap-1">
                        {levels.map((ref) => (
                          <LevelBadge key={`${ref.domain}:${ref.level}`} refValue={ref} tested={coverageAt(flower, ref) === "tested"} />
                        ))}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
