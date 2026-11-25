import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Fragment, useMemo, useState } from "react"
import { BLOOM, BLOOM_DOMAINS, levelsOf, toBloomRef, type BloomRef } from "@shared/bloom"
import { heatmapCells, heatmapKey, type CellCourses } from "@shared/coverage"
import { queries } from "@/api/queries"
import { DOMAIN_COLOR } from "@/components/bloom/colors"
import { Loading, QueryError } from "@/components/layout/ErrorView"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useCoverage, type CoverageData } from "@/hooks/useCoverage"
import { useProgramme } from "@/hooks/useProgramme"
import { FilterToggle, ViewHeader } from "./ViewHeader"

/** Sequential steps (one hue per domain): 1, 2, 3 and 4+ courses. */
const STEPS = [0.28, 0.5, 0.74, 1]

function intensity(count: number): number {
  if (count <= 0) return 0
  return STEPS[Math.min(count, STEPS.length) - 1] ?? 1
}

export function HeatmapView() {
  const { programme } = useProgramme()
  const structure = useQuery(queries.structure(programme.id))
  const coverage = useCoverage()
  const [testedOnly, setTestedOnly] = useState(false)
  const [studyGuideOnly, setStudyGuideOnly] = useState(false)

  const cells = useMemo(() => {
    const links = (coverage.data?.links ?? []).filter(
      (l) => (!testedOnly || l.tested) && (!studyGuideOnly || l.inStudyGuide),
    )
    return heatmapCells(links)
  }, [coverage.data, testedOnly, studyGuideOnly])

  return (
    <div className="space-y-6">
      <ViewHeader
        title="Bloom heatmap"
        description="For every LTO and Bloom level: how many courses provide evidence. Darker cells mean more courses; a dot means at least one course also tests it. Click a cell to see the courses."
      >
        <FilterToggle checked={testedOnly} onChange={setTestedOnly}>
          Count only tested levels
        </FilterToggle>
        <FilterToggle checked={studyGuideOnly} onChange={setStudyGuideOnly}>
          Only evidence that is explicit in the study guide
        </FilterToggle>
      </ViewHeader>
      {(structure.error ?? coverage.error) && (
        <QueryError error={structure.error ?? coverage.error} />
      )}
      {(!structure.data || !coverage.data) && !structure.error && !coverage.error && <Loading />}
      {structure.data && coverage.data && (
        <div className="overflow-x-auto rounded-xl border bg-card p-4">
          <table className="border-separate border-spacing-[2px] text-xs">
            <thead>
              <tr>
                <th />
                {BLOOM_DOMAINS.map((domain) => (
                  <th
                    key={domain}
                    colSpan={levelsOf(domain).length}
                    className="px-1 pb-1 text-left font-medium"
                    style={{ color: "var(--foreground)" }}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="size-2.5 rounded-sm"
                        style={{ background: DOMAIN_COLOR[domain] }}
                      />
                      {BLOOM[domain].label}
                    </span>
                  </th>
                ))}
              </tr>
              <tr>
                <th />
                {BLOOM_DOMAINS.flatMap((domain) =>
                  BLOOM[domain].levels.map((level) => (
                    <th
                      key={`${domain}:${level.key}`}
                      className="relative h-24 w-9 min-w-9 font-normal text-muted-foreground"
                    >
                      <span className="absolute bottom-1 left-1/2 origin-bottom-left -rotate-60 whitespace-nowrap">
                        {level.label}
                      </span>
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {structure.data.trajectories.map((trajectory) => (
                <Fragment key={trajectory.id}>
                  <tr>
                    <th colSpan={17} className="pt-3 pb-1 text-left text-sm font-semibold">
                      <span
                        className="mr-2 inline-block h-3 w-1 rounded-full align-middle"
                        style={{
                          background: trajectory.color || "var(--primary)",
                        }}
                      />
                      {trajectory.name}
                    </th>
                  </tr>
                  {trajectory.ltos.map((lto) => (
                    <tr key={lto.id}>
                      <th className="max-w-72 pr-3 text-left font-normal">
                        <Link
                          to="/p/$programmeId/ltos/$ltoId"
                          params={{
                            programmeId: programme.id,
                            ltoId: String(lto.id),
                          }}
                          search={(s) => ({ year: s.year })}
                          className="flex gap-2 hover:underline"
                          title={lto.title}
                        >
                          <span className="w-14 shrink-0 font-mono text-muted-foreground">
                            {lto.code}
                          </span>
                          <span className="truncate">{lto.title}</span>
                        </Link>
                      </th>
                      {BLOOM_DOMAINS.flatMap((domain) =>
                        levelsOf(domain).map((level) => {
                          const ref = toBloomRef(domain, level)
                          return (
                            <td key={`${domain}:${level}`} className="p-0">
                              <HeatCell
                                refValue={ref}
                                cell={cells.get(heatmapKey(lto.id, ref))}
                                coverage={coverage.data}
                                ltoCode={lto.code}
                              />
                            </td>
                          )
                        }),
                      )}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
          <HeatLegend />
        </div>
      )}
    </div>
  )
}

function HeatCell({
  refValue,
  cell,
  coverage,
  ltoCode,
}: {
  refValue: BloomRef
  cell: CellCourses | undefined
  coverage: CoverageData | undefined
  ltoCode: string
}) {
  const { programme } = useProgramme()
  const count = cell ? cell.taught.length + cell.tested.length : 0
  const color = DOMAIN_COLOR[refValue.domain]
  const level =
    BLOOM[refValue.domain].levels.find((l) => l.key === refValue.level)?.label ?? refValue.level
  if (!cell || count === 0) {
    return (
      <div
        className="size-9 rounded-[3px] bg-muted/60"
        title={`${ltoCode} · ${level}: no courses`}
      />
    )
  }
  const strength = intensity(count)
  const dark = strength >= 0.5
  const name = (id: number) => coverage?.courseById.get(id)
  return (
    <Popover>
      <PopoverTrigger
        className="relative flex size-9 items-center justify-center rounded-[3px] font-medium tabular-nums focus-visible:ring-2 focus-visible:ring-ring"
        style={{
          background: `color-mix(in oklab, ${color} ${Math.round(strength * 100)}%, var(--card))`,
          color: dark ? "white" : "var(--foreground)",
        }}
        title={`${ltoCode} · ${level}: ${count} course${count === 1 ? "" : "s"} (${cell.tested.length} testing)`}
      >
        {count}
        {cell.tested.length > 0 && (
          <span
            className="absolute top-0.5 right-0.5 size-1.5 rounded-full"
            style={{ background: dark ? "white" : color }}
          />
        )}
      </PopoverTrigger>
      <PopoverContent className="w-72 text-sm">
        <p className="mb-2 font-medium">
          {ltoCode} · {BLOOM[refValue.domain].label} · {level}
        </p>
        {(["tested", "taught"] as const).map((state) =>
          cell[state].length > 0 ? (
            <div key={state} className="mb-2">
              <p className="text-xs text-muted-foreground">
                {state === "tested" ? "Taught and tested" : "Taught, not tested"}
              </p>
              <ul>
                {cell[state].map((id) => (
                  <li key={id}>
                    <Link
                      to="/p/$programmeId/courses/$courseId"
                      params={{
                        programmeId: programme.id,
                        courseId: String(id),
                      }}
                      search={(s) => ({ year: s.year })}
                      className="hover:underline"
                    >
                      <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                        {name(id)?.code}
                      </span>
                      {name(id)?.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null,
        )}
      </PopoverContent>
    </Popover>
  )
}

function HeatLegend() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      <span>Courses providing evidence:</span>
      {STEPS.map((s, i) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span
            className="size-4 rounded-[3px]"
            style={{
              background: `color-mix(in oklab, var(--bloom-cognitive) ${Math.round(s * 100)}%, var(--card))`,
            }}
          />
          {i === STEPS.length - 1 ? `${i + 1}+` : i + 1}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-bloom-cognitive" /> at least one course tests it
      </span>
    </div>
  )
}
