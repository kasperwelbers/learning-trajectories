import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ChevronRight, MessageSquareWarning, RefreshCw, Sparkles } from "lucide-react"
import type { FrameworkDto, JustificationDto, LtoDto, LtoEvidenceResponse, TrajectoryDto } from "@shared/api"
import { BLOOM, levelInfo } from "@shared/bloom"
import { canEditTrajectory } from "@shared/roles"
import { keys } from "@/api/keys"
import { queries, useApiMutation } from "@/api/queries"
import { FlowerLegend, FlowerRow } from "@/components/bloom/Flower"
import { LevelBadge, SourceBadge } from "@/components/evidence/Badges"
import { Quote } from "@/components/evidence/Quote"
import { Loading, NotFoundView, QueryError } from "@/components/layout/ErrorView"
import { EditableNarrative } from "@/components/markdown/EditableNarrative"
import { useCoverage } from "@/hooks/useCoverage"
import { useProgramme } from "@/hooks/useProgramme"
import { ltoRoute } from "@/router"

export function LtoPage() {
  const { programme } = useProgramme()
  const ltoId = Number(ltoRoute.useParams().ltoId)
  const structure = useQuery(queries.structure(programme.id))
  if (structure.error) return <QueryError error={structure.error} />
  if (!structure.data) return <Loading />
  const trajectory = structure.data.trajectories.find((t) => t.ltos.some((l) => l.id === ltoId))
  const lto = trajectory?.ltos.find((l) => l.id === ltoId)
  if (!trajectory || !lto) return <NotFoundView />
  return <LtoContent trajectory={trajectory} lto={lto} />
}

function LtoContent({ trajectory, lto }: { trajectory: TrajectoryDto; lto: LtoDto }) {
  const { programme, year } = useProgramme()
  const coverage = useCoverage()
  const canEdit = canEditTrajectory(programme.access, trajectory.id)
  const flower = coverage.data?.flowers.get(lto.id)

  const update = useApiMutation<{ narrative: string }>({
    request: (body) => ({ method: "PATCH", path: `/api/p/${programme.id}/ltos/${lto.id}`, body: { ...body, version: lto.version } }),
    invalidate: () => [keys.structure(programme.id)],
    success: "Saved. Links to courses will be updated in a few minutes.",
  })

  return (
    <div className="space-y-12">
      <header className="space-y-5">
        <nav className="flex items-center gap-1 text-sm text-muted-foreground">
          <Link
            to="/p/$programmeId/trajectories/$trajectoryId"
            params={{ programmeId: programme.id, trajectoryId: String(trajectory.id) }}
            search={(s) => s}
            className="hover:underline"
          >
            {trajectory.name}
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="font-mono">{lto.code}</span>
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-8">
          <h1 className="max-w-3xl text-3xl leading-tight font-semibold">{lto.title}</h1>
          <FlowerRow coverage={flower} size={72} all labels />
        </div>
        {lto.relinkPending && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="size-3.5 animate-spin" /> This LTO changed recently; its links to courses are being updated.
          </p>
        )}
        <div className="max-w-3xl">
          <EditableNarrative
            value={lto.narrative}
            canEdit={canEdit}
            onSave={(narrative) => update.mutateAsync({ narrative })}
            programmeId={programme.id}
            empty="No narrative yet. The narrative explains what this outcome means; the AI reads it when linking courses."
            placeholder="What does this outcome mean? What should students be able to do, and how is it built up through the programme?"
          />
        </div>
      </header>

      <Justifications lto={lto} canEdit={canEdit} />

      <section className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold">Evidence from courses</h2>
            <p className="text-sm text-muted-foreground">
              Per course and Bloom level: the passages from course documents, and why the AI considers them evidence ({year}).
            </p>
          </div>
          <FlowerLegend />
        </div>
        <Evidence ltoId={lto.id} />
      </section>
    </div>
  )
}

// ── Justifications ──────────────────────────────────────────────────────────

function Justifications({ lto, canEdit }: { lto: LtoDto; canEdit: boolean }) {
  const { programme } = useProgramme()
  const frameworks = useQuery(queries.frameworks(programme.id))
  const justifications = useQuery(queries.justifications(programme.id))
  if (frameworks.data?.length === 0) return null
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold">Is this outcome achieved?</h2>
        <p className="text-sm text-muted-foreground">
          The trajectory coordinator&apos;s justification, per indicator of each framework.
        </p>
      </div>
      {(frameworks.error ?? justifications.error) && <QueryError error={frameworks.error ?? justifications.error} />}
      {frameworks.data?.map((framework) => (
        <FrameworkJustifications
          key={framework.id}
          framework={framework}
          lto={lto}
          canEdit={canEdit}
          justifications={justifications.data ?? []}
        />
      ))}
    </section>
  )
}

function FrameworkJustifications({
  framework,
  lto,
  canEdit,
  justifications,
}: {
  framework: FrameworkDto
  lto: LtoDto
  canEdit: boolean
  justifications: JustificationDto[]
}) {
  const { programme } = useProgramme()
  const save = useApiMutation<{ indicatorId: number; text: string; version: number | null }>({
    request: ({ indicatorId, text, version }) => ({
      method: "PUT",
      path: `/api/p/${programme.id}/ltos/${lto.id}/justifications/${indicatorId}`,
      body: { text, version },
    }),
    invalidate: () => [keys.justifications(programme.id)],
  })
  return (
    <details className="group rounded-xl border bg-card" open>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
        <h3 className="text-lg font-semibold">{framework.name}</h3>
        <span className="ml-auto text-xs text-muted-foreground">
          {framework.indicators.filter((i) => justifications.some((j) => j.ltoId === lto.id && j.indicatorId === i.id && j.text.trim())).length}
          {" / "}
          {framework.indicators.length} justified
        </span>
      </summary>
      <div className="divide-y border-t">
        {framework.indicators.map((indicator) => {
          const current = justifications.find((j) => j.ltoId === lto.id && j.indicatorId === indicator.id)
          return (
            <div key={indicator.id} className="grid gap-3 px-5 py-4 md:grid-cols-[14rem_1fr]">
              <div>
                <p className="font-medium">
                  {indicator.code && <span className="mr-1.5 font-mono text-xs text-muted-foreground">{indicator.code}</span>}
                  {indicator.name}
                </p>
                <p className="mt-1 line-clamp-4 text-xs text-muted-foreground" title={indicator.description}>
                  {indicator.description}
                </p>
              </div>
              <div>
                <EditableNarrative
                  value={current?.text ?? ""}
                  canEdit={canEdit}
                  onSave={(text) => save.mutateAsync({ indicatorId: indicator.id, text, version: current?.version ?? null })}
                  programmeId={programme.id}
                  empty="Not justified yet."
                  placeholder="How does achieving this outcome satisfy this indicator?"
                />
                {current?.updatedBy && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Last edited by {current.updatedBy} on {new Date(current.updatedAt).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </details>
  )
}

// ── Evidence ────────────────────────────────────────────────────────────────

function Evidence({ ltoId }: { ltoId: number }) {
  const { programme, year } = useProgramme()
  const evidence = useQuery(queries.evidence(programme.id, ltoId, year))
  if (evidence.error) return <QueryError error={evidence.error} />
  if (!evidence.data) return <Loading />
  if (evidence.data.courses.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
        No course provides evidence for this outcome in {year} yet.
      </p>
    )
  }
  return (
    <div className="space-y-4">
      {evidence.data.courses.map((entry) => (
        <CourseEvidence key={entry.course.id} entry={entry} ltoId={ltoId} />
      ))}
    </div>
  )
}

function CourseEvidence({ entry, ltoId }: { entry: LtoEvidenceResponse["courses"][number]; ltoId: number }) {
  const { programme, year } = useProgramme()
  const openDisputes = entry.disputes.filter((d) => d.status === "open")
  return (
    <article className="rounded-xl border bg-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-3">
        <Link
          to="/p/$programmeId/courses/$courseId"
          params={{ programmeId: programme.id, courseId: String(entry.course.id) }}
          search={(s) => ({ year: s.year, lto: ltoId })}
          className="font-semibold hover:underline"
        >
          <span className="mr-2 font-mono text-xs text-muted-foreground">{entry.course.code}</span>
          {entry.course.name}
        </Link>
        {entry.course.analysisYear && entry.course.analysisYear !== year && (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs">from {entry.course.analysisYear}</span>
        )}
        <span className="ml-auto flex flex-wrap gap-1">
          {entry.levels.map((l) => (
            <LevelBadge key={`${l.domain}:${l.level}`} refValue={l} tested={l.tested} />
          ))}
        </span>
      </header>
      {openDisputes.length > 0 && (
        <div className="space-y-1 border-b bg-warning/10 px-5 py-3 text-sm">
          {openDisputes.map((d) => (
            <p key={d.id} className="flex gap-2">
              <MessageSquareWarning className="mt-0.5 size-4 shrink-0 text-warning" />
              <span>
                <span className="font-medium">Disputed{d.ref ? ` at ${levelInfo(d.ref).label}` : ""}</span> by {d.createdBy}: {d.text}
              </span>
            </p>
          ))}
        </div>
      )}
      <div className="divide-y">
        {entry.levels.map((level) => (
          <div key={`${level.domain}:${level.level}`} className="space-y-3 px-5 py-4">
            <p className="text-sm font-medium">
              {BLOOM[level.domain].label} · {levelInfo(level).label}{" "}
              <span className="font-normal text-muted-foreground">— {level.tested ? "taught and tested" : "taught, not tested"}</span>
            </p>
            {level.links.map((link, i) => (
              <div key={i} className="space-y-3">
                <p className="flex gap-2 text-sm text-muted-foreground">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {link.origin === "pointer" && <span className="font-medium text-foreground">Pointed out by the coordinator. </span>}
                    {link.justification}{" "}
                    <span className="text-xs">(confidence {Math.round(link.confidence * 100)}%)</span>
                  </span>
                </p>
                <div className="flex flex-wrap gap-1 pl-5">
                  {link.sources.map((s) => (
                    <SourceBadge key={s} kind={s} />
                  ))}
                </div>
                <div className="space-y-3 pl-5">
                  {link.statements.map((s) => (
                    <Quote
                      key={s.id}
                      programmeId={programme.id}
                      quote={s.quote}
                      context={s.context}
                      kind={s.kind}
                      page={s.page}
                      verification={s.verification}
                      document={s.document}
                      assessedBy={s.assessedBy}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </article>
  )
}
