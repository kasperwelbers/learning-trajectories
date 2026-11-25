import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import type { CourseFactsDto, TrajectoryDto } from "@shared/api"
import { coveredDomains, flowerFromLinks, groupBy } from "@shared/coverage"
import { queries } from "@/api/queries"
import { Flower, FlowerLegend, FlowerRow } from "@/components/bloom/Flower"
import { Loading, QueryError } from "@/components/layout/ErrorView"
import { MarkdownView } from "@/components/markdown/MarkdownView"
import { useCoverage, type CoverageData } from "@/hooks/useCoverage"
import { useProgramme } from "@/hooks/useProgramme"
import { courseYear } from "@/lib/curriculum"
import { formatPeriods } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ViewHeader } from "./ViewHeader"

interface Slot {
  key: string
  year: number | null
  period: number | null
  label: string
}

function slotOf(course: CourseFactsDto): Slot {
  const year = courseYear(course)
  const period = course.periods.length ? Math.min(...course.periods) : null
  if (year === null)
    return {
      key: "unscheduled",
      year: null,
      period: null,
      label: "Not scheduled",
    }
  return {
    key: `${year}|${period ?? 0}`,
    year,
    period,
    label: period ? `P${period}` : "–",
  }
}

export function JourneyView() {
  const { programme } = useProgramme()
  const structure = useQuery(queries.structure(programme.id))
  const coverage = useCoverage()
  const [selected, setSelected] = useState<number | null>(null)
  const trajectories = structure.data?.trajectories ?? []
  const trajectory = trajectories.find((t) => t.id === selected) ?? trajectories[0]

  return (
    <div className="space-y-6">
      <ViewHeader
        title="Trajectory journey"
        description="How students progress through a learning trajectory: the courses that contribute to each outcome, in the order students take them, and the Bloom levels they reach."
      >
        <div className="flex flex-wrap gap-1">
          {trajectories.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelected(t.id)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm",
                t.id === trajectory?.id
                  ? "border-foreground bg-foreground text-background"
                  : "hover:bg-muted",
              )}
            >
              <span
                className="size-2.5 rounded-full"
                style={{ background: t.color || "var(--primary)" }}
              />
              {t.name}
            </button>
          ))}
        </div>
      </ViewHeader>
      {(structure.error ?? coverage.error) && (
        <QueryError error={structure.error ?? coverage.error} />
      )}
      {(!structure.data || !coverage.data) && !structure.error && !coverage.error && <Loading />}
      {trajectory && coverage.data && <Journey trajectory={trajectory} coverage={coverage.data} />}
      <FlowerLegend />
    </div>
  )
}

function Journey({ trajectory, coverage }: { trajectory: TrajectoryDto; coverage: CoverageData }) {
  const { programme } = useProgramme()
  const ltoIds = new Set(trajectory.ltos.map((l) => l.id))
  const links = coverage.links.filter((l) => ltoIds.has(l.ltoId))
  const byCell = useMemo(() => groupBy(links, (l) => `${l.ltoId}|${l.courseId}`), [links])

  const slots = useMemo(() => {
    const contributing = new Set(links.map((l) => l.courseId))
    const map = new Map<string, { slot: Slot; courses: CourseFactsDto[] }>()
    for (const course of coverage.courses) {
      if (!contributing.has(course.id)) continue
      const slot = slotOf(course)
      const entry = map.get(slot.key) ?? { slot, courses: [] }
      entry.courses.push(course)
      map.set(slot.key, entry)
    }
    return [...map.values()].sort(
      (a, b) =>
        (a.slot.year ?? 99) - (b.slot.year ?? 99) || (a.slot.period ?? 0) - (b.slot.period ?? 0),
    )
  }, [links, coverage.courses])

  const years = [...new Set(slots.map((s) => s.slot.year))]

  return (
    <div className="space-y-4">
      {trajectory.narrative && (
        <MarkdownView
          markdown={trajectory.narrative}
          className="line-clamp-4 max-w-3xl text-sm text-muted-foreground"
        />
      )}
      {slots.length === 0 ? (
        <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          No course contributes to this trajectory yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-card" />
                {years.map((year) => (
                  <th
                    key={year ?? "none"}
                    colSpan={slots.filter((s) => s.slot.year === year).length}
                    className="border-b border-l px-3 pt-3 pb-1 text-left font-serif text-base font-semibold"
                  >
                    {year === null ? "Not scheduled" : `Year ${year}`}
                  </th>
                ))}
                <th className="border-b border-l px-3 pt-3 pb-1 text-left font-serif text-base font-semibold">
                  Reached
                </th>
              </tr>
              <tr>
                <th className="sticky left-0 z-10 border-b bg-card" />
                {slots.map(({ slot }) => (
                  <th
                    key={slot.key}
                    className="border-b border-l px-3 py-1 text-left text-xs font-normal text-muted-foreground"
                  >
                    {slot.year === null ? "" : slot.label}
                  </th>
                ))}
                <th className="border-b border-l" />
              </tr>
            </thead>
            <tbody>
              {trajectory.ltos.map((lto) => (
                <tr key={lto.id} className="align-top">
                  <th className="sticky left-0 z-10 w-72 min-w-56 border-b bg-card px-4 py-3 text-left font-normal">
                    <Link
                      to="/p/$programmeId/ltos/$ltoId"
                      params={{
                        programmeId: programme.id,
                        ltoId: String(lto.id),
                      }}
                      search={(s) => ({ year: s.year })}
                      className="hover:underline"
                    >
                      <span className="block font-mono text-xs text-muted-foreground">
                        {lto.code}
                      </span>
                      <span className="line-clamp-3">{lto.title}</span>
                    </Link>
                  </th>
                  {slots.map(({ slot, courses }) => (
                    <td key={slot.key} className="border-b border-l px-2 py-2">
                      <div className="flex flex-col gap-1.5">
                        {courses.map((course) => {
                          const cell = byCell.get(`${lto.id}|${course.id}`)
                          if (!cell) return null
                          const flower = flowerFromLinks(cell)
                          return (
                            <Link
                              key={course.id}
                              to="/p/$programmeId/courses/$courseId"
                              params={{
                                programmeId: programme.id,
                                courseId: String(course.id),
                              }}
                              search={(s) => ({ year: s.year, lto: lto.id })}
                              className="flex items-center gap-1.5 rounded-md border bg-background px-1.5 py-1 text-xs hover:shadow-sm"
                              title={`${course.name} (${formatPeriods(course.periods)})`}
                            >
                              {coveredDomains(flower).map((domain) => (
                                <Flower key={domain} domain={domain} coverage={flower} size={18} />
                              ))}
                              <span className="font-mono">{course.code}</span>
                            </Link>
                          )
                        })}
                      </div>
                    </td>
                  ))}
                  <td className="border-b border-l px-3 py-2">
                    <FlowerRow coverage={coverage.flowers.get(lto.id)} size={30} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
