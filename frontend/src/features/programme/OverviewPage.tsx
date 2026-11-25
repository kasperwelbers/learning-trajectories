import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { AlertTriangle, ArrowRight, FileWarning, RefreshCw } from "lucide-react"
import type { RelinkResponse, TrajectoryDto } from "@shared/api"
import { isProgrammeAdmin } from "@shared/roles"
import { keys } from "@/api/keys"
import { queries, useApiMutation } from "@/api/queries"
import { FlowerLegend, FlowerRow } from "@/components/bloom/Flower"
import { Loading, QueryError } from "@/components/layout/ErrorView"
import { EditableNarrative } from "@/components/markdown/EditableNarrative"
import { Button } from "@/components/ui/button"
import { useCoverage, type CoverageData } from "@/hooks/useCoverage"
import { useProgramme } from "@/hooks/useProgramme"

export function OverviewPage() {
  const { programme, year } = useProgramme()
  const structure = useQuery(queries.structure(programme.id))
  const courses = useQuery(queries.courses(programme.id, year))
  const coverage = useCoverage()
  const admin = isProgrammeAdmin(programme.access)

  const saveDescription = useApiMutation<string>({
    request: (description) => ({
      method: "PATCH",
      path: `/api/p/${programme.id}`,
      body: { description, version: programme.version },
    }),
    invalidate: () => [keys.programme(programme.id)],
  })

  const courseList = courses.data?.courses ?? []
  const analysed = courseList.filter((c) => c.analysisYear !== null).length
  const stale = courseList.filter((c) => c.stale).length
  const withoutDescription = courseList.filter((c) => !c.hasManual && !c.hasStudyGuide).length
  const ltoCount = structure.data?.trajectories.reduce((n, t) => n + t.ltos.length, 0) ?? 0

  return (
    <div className="space-y-10">
      <section className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Academic year {year}</p>
          <h1 className="text-4xl font-semibold">{programme.name}</h1>
          <EditableNarrative
            value={programme.description}
            canEdit={admin}
            onSave={(text) => saveDescription.mutateAsync(text)}
            programmeId={programme.id}
            empty="No programme description yet."
            placeholder="Describe the programme and how its learning trajectories fit together…"
          />
        </div>
        <aside className="space-y-3 self-start rounded-xl border bg-card p-5">
          <Stat label="Learning trajectories" value={structure.data?.trajectories.length ?? "–"} />
          <Stat label="Trajectory outcomes (LTOs)" value={ltoCount} />
          <Stat label="Courses analysed" value={`${analysed} / ${courseList.length}`} />
          {withoutDescription > 0 && (
            <Notice icon={<FileWarning className="size-4" />}>
              {withoutDescription} course{withoutDescription === 1 ? " has" : "s have"} no manual or study guide for {year}.
            </Notice>
          )}
          {stale > 0 && <StaleNotice count={stale} admin={admin} />}
          <Link to="/p/$programmeId/courses" params={{ programmeId: programme.id }} search={(s) => s} className="flex items-center gap-1 pt-1 text-sm text-primary hover:underline">
            All courses <ArrowRight className="size-3.5" />
          </Link>
        </aside>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-2xl font-semibold">Learning trajectories</h2>
          <FlowerLegend />
        </div>
        {structure.error && <QueryError error={structure.error} />}
        {!structure.data && !structure.error && <Loading />}
        {structure.data?.trajectories.length === 0 && (
          <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
            No trajectories yet.
            {admin && (
              <>
                {" "}
                <Link to="/p/$programmeId/settings" params={{ programmeId: programme.id }} search={{ tab: "import" }} className="text-primary hover:underline">
                  Import LTOs
                </Link>{" "}
                or add trajectories in the settings.
              </>
            )}
          </div>
        )}
        <div className="grid gap-5 md:grid-cols-2">
          {structure.data?.trajectories.map((t) => (
            <TrajectoryCard key={t.id} trajectory={t} coverage={coverage.data} />
          ))}
        </div>
      </section>
    </div>
  )
}

function TrajectoryCard({ trajectory, coverage }: { trajectory: TrajectoryDto; coverage: CoverageData | undefined }) {
  const { programme } = useProgramme()
  return (
    <article className="overflow-hidden rounded-xl border bg-card">
      <div className="h-1.5" style={{ background: trajectory.color || "var(--primary)" }} />
      <div className="space-y-4 p-5">
        <Link
          to="/p/$programmeId/trajectories/$trajectoryId"
          params={{ programmeId: programme.id, trajectoryId: String(trajectory.id) }}
          search={(s) => s}
          className="group flex items-start justify-between gap-3"
        >
          <h3 className="text-xl font-semibold group-hover:underline">{trajectory.name}</h3>
          <ArrowRight className="mt-1.5 size-4 shrink-0 text-muted-foreground" />
        </Link>
        <ul className="divide-y">
          {trajectory.ltos.map((lto) => (
            <li key={lto.id}>
              <Link
                to="/p/$programmeId/ltos/$ltoId"
                params={{ programmeId: programme.id, ltoId: String(lto.id) }}
                search={(s) => s}
                className="flex items-center gap-3 py-2.5 hover:bg-muted/40"
              >
                <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{lto.code}</span>
                <span className="line-clamp-2 flex-1 text-sm">{lto.title}</span>
                <FlowerRow coverage={coverage?.flowers.get(lto.id)} size={22} className="shrink-0" />
              </Link>
            </li>
          ))}
          {trajectory.ltos.length === 0 && <li className="py-3 text-sm text-muted-foreground">No LTOs yet.</li>}
        </ul>
      </div>
    </article>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold">{value}</span>
    </div>
  )
}

function Notice({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-lg bg-warning/10 p-2.5 text-sm">
      <span className="mt-0.5 text-warning">{icon}</span>
      <span>{children}</span>
    </div>
  )
}

function StaleNotice({ count, admin }: { count: number; admin: boolean }) {
  const { programme } = useProgramme()
  const relink = useApiMutation<undefined, RelinkResponse>({
    request: () => ({ method: "POST", path: `/api/p/${programme.id}/relink` }),
    success: (r) =>
      r.analysesStarted + r.ltosRelinked === 0
        ? "Nothing to update"
        : `Updating ${r.analysesStarted} course analyses and ${r.ltosRelinked} LTOs`,
  })
  return (
    <Notice icon={<AlertTriangle className="size-4" />}>
      <span className="block">
        {count} course{count === 1 ? " is" : "s are"} out of date (documents or LTOs changed).
      </span>
      {admin && (
        <Button size="xs" variant="outline" className="mt-2" disabled={relink.isPending} onClick={() => relink.mutate(undefined)}>
          <RefreshCw /> Update now
        </Button>
      )}
    </Notice>
  )
}
