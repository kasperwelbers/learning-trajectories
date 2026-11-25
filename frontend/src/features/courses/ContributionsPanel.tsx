import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  Check,
  ChevronDown,
  Crosshair,
  Hourglass,
  MessageSquareWarning,
  RefreshCw,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react"
import type {
  CourseDetailResponse,
  DisputeDto,
  LinkDto,
  LtoDto,
  PointerDto,
  StatementDto,
  TrajectoryDto,
} from "@shared/api"
import {
  ALL_BLOOM_REFS,
  BLOOM,
  bloomRefKey,
  levelIndex,
  levelInfo,
  BLOOM_DOMAINS,
  type BloomRef,
} from "@shared/bloom"
import { flowerFromLinks } from "@shared/coverage"
import { keys } from "@/api/keys"
import { queries, useApiMutation } from "@/api/queries"
import { FlowerRow } from "@/components/bloom/Flower"
import { LevelBadge, SourceBadge } from "@/components/evidence/Badges"
import { Quote } from "@/components/evidence/Quote"
import { ConfirmButton } from "@/components/layout/ConfirmButton"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useProgramme } from "@/hooks/useProgramme"
import { cn } from "@/lib/utils"
import { courseRoute } from "@/router"

interface LtoEntry {
  trajectory: TrajectoryDto
  lto: LtoDto
  links: LinkDto[]
  disputes: DisputeDto[]
  pointers: PointerDto[]
}

export function ContributionsPanel({
  detail,
  canEdit,
}: {
  detail: CourseDetailResponse
  canEdit: boolean
}) {
  const { programme } = useProgramme()
  const structure = useQuery(queries.structure(programme.id))
  const [pointerFor, setPointerFor] = useState<LtoDto | "pick" | null>(null)
  const analysis = detail.analysis

  const entries = useMemo<LtoEntry[]>(() => {
    const trajectories = structure.data?.trajectories ?? []
    return trajectories.flatMap((trajectory) =>
      trajectory.ltos.map((lto) => ({
        trajectory,
        lto,
        links: (analysis?.links ?? []).filter((l) => l.ltoId === lto.id),
        disputes: detail.disputes.filter((d) => d.ltoId === lto.id),
        pointers: detail.pointers.filter((p) => p.ltoId === lto.id),
      })),
    )
  }, [structure.data, analysis, detail.disputes, detail.pointers])

  const linked = entries.filter(
    (e) => e.links.length > 0 || e.disputes.length > 0 || e.pointers.length > 0,
  )
  const unlinked = entries.filter((e) => !linked.includes(e))
  const statements = useMemo(
    () => new Map((analysis?.statements ?? []).map((s) => [s.id, s])),
    [analysis],
  )

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Contribution to the learning trajectories</h2>
          <p className="text-sm text-muted-foreground">
            The AI linked passages from the course documents to LTOs. Disagree? Dispute a link.
            Missing something? Point to the passage.
          </p>
        </div>
        {canEdit && detail.documents.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setPointerFor("pick")}>
            <Crosshair /> Point to evidence
          </Button>
        )}
      </div>
      {!analysis?.links.length && linked.length === 0 && (
        <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
          {analysis?.status === "done" ? "The AI found no links to any LTO." : "No links yet."}
        </p>
      )}
      <div className="space-y-3">
        {linked.map((entry) => (
          <LtoContribution
            key={entry.lto.id}
            entry={entry}
            detail={detail}
            statements={statements}
            canEdit={canEdit}
            onPoint={() => setPointerFor(entry.lto)}
          />
        ))}
      </div>
      {unlinked.length > 0 && (
        <details className="rounded-xl border bg-card px-5 py-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            {unlinked.length} LTOs without evidence from this course
          </summary>
          <ul className="mt-3 space-y-1.5">
            {unlinked.map(({ lto }) => (
              <li key={lto.id} className="flex items-start gap-3">
                <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
                  {lto.code}
                </span>
                <span className="flex-1">{lto.title}</span>
                {canEdit && detail.documents.length > 0 && (
                  <Button size="xs" variant="ghost" onClick={() => setPointerFor(lto)}>
                    <Crosshair /> Point
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {pointerFor !== null && (
        <PointerDialog
          detail={detail}
          entries={entries}
          initialLto={pointerFor === "pick" ? null : pointerFor}
          onClose={() => setPointerFor(null)}
        />
      )}
    </section>
  )
}

function LtoContribution({
  entry,
  detail,
  statements,
  canEdit,
  onPoint,
}: {
  entry: LtoEntry
  detail: CourseDetailResponse
  statements: Map<number, StatementDto>
  canEdit: boolean
  onPoint: () => void
}) {
  const { programme } = useProgramme()
  const { lto: highlight } = courseRoute.useSearch()
  const ref = useRef<HTMLElement>(null)
  const [disputing, setDisputing] = useState(false)
  const isHighlighted = highlight === entry.lto.id
  const hasFeedback =
    entry.disputes.some((d) => d.status === "open") ||
    entry.pointers.some((p) => p.status === "pending")
  const [expanded, setExpanded] = useState(isHighlighted || hasFeedback)

  useEffect(() => {
    if (isHighlighted) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [isHighlighted])

  const levels = [...entry.links].sort(
    (a, b) =>
      BLOOM_DOMAINS.indexOf(a.domain) - BLOOM_DOMAINS.indexOf(b.domain) ||
      levelIndex(a) - levelIndex(b),
  )
  const documents = new Map(detail.documents.map((d) => [d.id, d]))
  const sources = [...new Set(entry.links.flatMap((l) => l.sources))]

  return (
    <article
      ref={ref}
      className={cn("rounded-xl border bg-card", isHighlighted && "ring-2 ring-primary/40")}
    >
      <header className="flex flex-wrap items-start gap-3 px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            {entry.trajectory.name} · <span className="font-mono">{entry.lto.code}</span>
          </p>
          <Link
            to="/p/$programmeId/ltos/$ltoId"
            params={{ programmeId: programme.id, ltoId: String(entry.lto.id) }}
            search={(s) => ({ year: s.year })}
            className="font-serif leading-snug hover:underline"
          >
            {entry.lto.title}
          </Link>
        </div>
        <FlowerRow coverage={flowerFromLinks(entry.links)} size={30} />
        <div className="flex w-full flex-wrap items-center gap-1.5">
          {levels.map((link) => (
            <LevelBadge key={link.id} refValue={link} tested={link.tested} />
          ))}
          {sources.map((s) => (
            <SourceBadge key={s} kind={s} />
          ))}
          {entry.disputes.some((d) => d.status === "open") && (
            <span className="inline-flex items-center gap-1 text-xs text-warning">
              <MessageSquareWarning className="size-3.5" /> disputed
            </span>
          )}
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            <ChevronDown className={cn("transition-transform", expanded && "rotate-180")} />
            {expanded ? "Hide evidence" : "Show evidence"}
          </Button>
        </div>
      </header>
      {expanded && (
        <div className="divide-y border-t">
          {levels.map((link) => (
            <div key={link.id} className="space-y-3 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <LevelBadge refValue={link} tested={link.tested} />
                <span className="text-xs text-muted-foreground">
                  {BLOOM[link.domain].label} ·{" "}
                  {link.tested ? "taught and tested" : "taught, not tested"} · confidence{" "}
                  {Math.round(link.confidence * 100)}%
                </span>
                {link.origin === "pointer" && (
                  <span className="rounded-full bg-accent px-2 py-0.5 text-[0.7rem] text-accent-foreground">
                    pointed out by coordinator
                  </span>
                )}
                {link.stale && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <RefreshCw className="size-3" /> LTO changed, being re-linked
                  </span>
                )}
                <span className="ml-auto flex gap-1">
                  {link.sources.map((s) => (
                    <SourceBadge key={s} kind={s} />
                  ))}
                </span>
              </div>
              <p className="flex gap-2 text-sm text-muted-foreground">
                <Sparkles className="mt-0.5 size-3.5 shrink-0" />
                {link.justification}
              </p>
              <div className="space-y-3 pl-5">
                {link.statementIds.map((id) => {
                  const s = statements.get(id)
                  const doc = s ? documents.get(s.documentId) : undefined
                  if (!s) return null
                  return (
                    <Quote
                      key={id}
                      programmeId={programme.id}
                      quote={s.quote}
                      context={s.context}
                      kind={s.kind}
                      page={s.page}
                      verification={s.verification}
                      document={
                        doc
                          ? {
                              id: doc.id,
                              kind: doc.kind,
                              filename: doc.filename,
                            }
                          : undefined
                      }
                      assessedBy={s.assessedBy}
                    />
                  )
                })}
              </div>
            </div>
          ))}
          {entry.pointers.map((p) => (
            <PointerItem key={p.id} pointer={p} canEdit={canEdit} />
          ))}
          {entry.disputes.map((d) => (
            <DisputeItem key={d.id} dispute={d} canEdit={canEdit} links={entry.links} />
          ))}
        </div>
      )}
      {canEdit && expanded && (
        <footer className="flex gap-1 border-t px-3 py-2">
          <Button size="xs" variant="ghost" onClick={() => setDisputing(true)}>
            <MessageSquareWarning /> Dispute
          </Button>
          <Button size="xs" variant="ghost" onClick={onPoint}>
            <Crosshair /> Point to more evidence
          </Button>
        </footer>
      )}
      {disputing && (
        <DisputeDialog
          courseId={detail.course.id}
          entry={entry}
          onClose={() => setDisputing(false)}
        />
      )}
    </article>
  )
}

function useCourseInvalidation(courseId: number) {
  const { programme, year } = useProgramme()
  return () => [
    keys.course(programme.id, courseId, year),
    ["p", programme.id, "coverage"],
    ["p", programme.id, "courses"],
  ]
}

function DisputeItem({
  dispute,
  canEdit,
  links,
}: {
  dispute: DisputeDto
  canEdit: boolean
  links: LinkDto[]
}) {
  const { programme } = useProgramme()
  const invalidate = useCourseInvalidation(dispute.courseId)
  const update = useApiMutation<"open" | "resolved">({
    request: (status) => ({
      method: "PATCH",
      path: `/api/p/${programme.id}/disputes/${dispute.id}`,
      body: { status },
    }),
    invalidate,
  })
  const remove = useApiMutation<undefined>({
    request: () => ({
      method: "DELETE",
      path: `/api/p/${programme.id}/disputes/${dispute.id}`,
    }),
    invalidate,
  })
  const disputedRef = dispute.ref
  const stillPresent = disputedRef
    ? links.some((l) => bloomRefKey(l) === bloomRefKey(disputedRef))
    : links.length > 0
  return (
    <div
      className={cn(
        "flex gap-3 px-5 py-3 text-sm",
        dispute.status === "open" ? "bg-warning/10" : "text-muted-foreground",
      )}
    >
      <MessageSquareWarning
        className={cn("mt-0.5 size-4 shrink-0", dispute.status === "open" && "text-warning")}
      />
      <div className="flex-1 space-y-1">
        <p>
          <span className="font-medium">
            {dispute.status === "resolved" ? "Resolved dispute" : "Disputed"}
            {dispute.ref ? ` · ${levelInfo(dispute.ref).label}` : " · whole LTO"}
          </span>{" "}
          — {dispute.text}
        </p>
        <p className="text-xs text-muted-foreground">
          {dispute.createdBy} · {dispute.year}
          {dispute.status === "open" &&
            (stillPresent
              ? " · the link is still present after re-analysis"
              : " · the disputed link is gone")}
        </p>
      </div>
      {canEdit && (
        <div className="flex gap-1">
          {dispute.status === "open" ? (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Mark resolved"
              title="Mark resolved"
              onClick={() => update.mutate("resolved")}
            >
              <Check />
            </Button>
          ) : (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Reopen"
              title="Reopen"
              onClick={() => update.mutate("open")}
            >
              <Undo2 />
            </Button>
          )}
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Delete"
            title="Delete"
            onClick={() => remove.mutate(undefined)}
          >
            <Trash2 />
          </Button>
        </div>
      )}
    </div>
  )
}

const POINTER_STATUS: Record<PointerDto["status"], { label: string; icon: typeof Check }> = {
  pending: { label: "Waiting for the AI to judge", icon: Hourglass },
  supported: { label: "The AI agrees", icon: Check },
  not_supported: { label: "The AI does not consider this evidence", icon: X },
  failed: { label: "The AI could not judge this", icon: X },
}

function PointerItem({ pointer, canEdit }: { pointer: PointerDto; canEdit: boolean }) {
  const { programme } = useProgramme()
  const invalidate = useCourseInvalidation(pointer.courseId)
  const remove = useApiMutation<undefined>({
    request: () => ({
      method: "DELETE",
      path: `/api/p/${programme.id}/pointers/${pointer.id}`,
    }),
    invalidate,
    success: "Pointer removed",
  })
  const status = POINTER_STATUS[pointer.status]
  return (
    <div className="flex gap-3 px-5 py-3 text-sm">
      <Crosshair className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 space-y-1">
        <p className="italic">“{pointer.passage}”</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <status.icon className="size-3.5" /> {status.label}
          {pointer.verdict && <> — {pointer.verdict}</>}
        </p>
        {pointer.note && <p className="text-xs text-muted-foreground">Note: {pointer.note}</p>}
      </div>
      {canEdit && (
        <ConfirmButton
          title="Remove this pointer?"
          description="Links created from it are removed as well."
          confirmLabel="Remove"
          onConfirm={() => remove.mutate(undefined)}
        >
          <Button size="icon-xs" variant="ghost" aria-label="Remove pointer">
            <Trash2 />
          </Button>
        </ConfirmButton>
      )}
    </div>
  )
}

function DisputeDialog({
  courseId,
  entry,
  onClose,
}: {
  courseId: number
  entry: LtoEntry
  onClose: () => void
}) {
  const { programme, year } = useProgramme()
  const [level, setLevel] = useState<string>("all")
  const [text, setText] = useState("")
  const create = useApiMutation<{ ref: BloomRef | null; text: string }>({
    request: (body) => ({
      method: "POST",
      path: `/api/p/${programme.id}/courses/${courseId}/disputes`,
      body: { ...body, year, ltoId: entry.lto.id },
    }),
    invalidate: useCourseInvalidation(courseId),
    success: "Dispute recorded",
  })
  const linkedRefs = ALL_BLOOM_REFS.filter((r) =>
    entry.links.some((l) => bloomRefKey(l) === bloomRefKey(r)),
  )
  const submit = (event: SyntheticEvent) => {
    event.preventDefault()
    const ref = linkedRefs.find((r) => bloomRefKey(r) === level) ?? null
    create.mutate({ ref, text }, { onSuccess: onClose })
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Dispute a link to {entry.lto.code}</DialogTitle>
            <DialogDescription>
              Your note is shown next to the link for everyone. It does not change the AI&apos;s
              result; improving the course documents does.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>What do you dispute?</Label>
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">The link to this LTO as a whole</SelectItem>
                {linkedRefs.map((r) => (
                  <SelectItem key={bloomRefKey(r)} value={bloomRefKey(r)}>
                    The {BLOOM[r.domain].label.toLowerCase()} level “{levelInfo(r).label}”
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dispute-text">Why?</Label>
            <Textarea
              id="dispute-text"
              required
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Students only discuss this; they do not evaluate it themselves."
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              Record dispute
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PointerDialog({
  detail,
  entries,
  initialLto,
  onClose,
}: {
  detail: CourseDetailResponse
  entries: LtoEntry[]
  initialLto: LtoDto | null
  onClose: () => void
}) {
  const { programme, year } = useProgramme()
  const [ltoId, setLtoId] = useState(initialLto ? String(initialLto.id) : "")
  const [documentId, setDocumentId] = useState(
    String(detail.documents.find((d) => d.kind === "manual")?.id ?? detail.documents[0]?.id ?? ""),
  )
  const [passage, setPassage] = useState("")
  const [page, setPage] = useState("")
  const [note, setNote] = useState("")
  const create = useApiMutation<undefined>({
    request: () => ({
      method: "POST",
      path: `/api/p/${programme.id}/courses/${detail.course.id}/pointers`,
      body: {
        year,
        ltoId: Number(ltoId),
        documentId: Number(documentId),
        passage,
        page: page ? Number(page) : null,
        note,
      },
    }),
    invalidate: useCourseInvalidation(detail.course.id),
    success:
      detail.analysis?.status === "done"
        ? "Sent to the AI for judgement"
        : "Saved; it will be judged in the next analysis",
  })
  const submit = (event: SyntheticEvent) => {
    event.preventDefault()
    create.mutate(undefined, { onSuccess: onClose })
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Point to evidence</DialogTitle>
            <DialogDescription>
              Copy the passage from one of the course documents. The AI judges it with the same
              rules it uses for all courses; your note is for people only.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>LTO</Label>
            <Select value={ltoId} onValueChange={setLtoId} required>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose an LTO" />
              </SelectTrigger>
              <SelectContent>
                {entries.map(({ lto }) => (
                  <SelectItem key={lto.id} value={String(lto.id)}>
                    <span className="font-mono text-xs">{lto.code}</span> {lto.title.slice(0, 70)}
                    {lto.title.length > 70 ? "…" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <div className="space-y-2">
              <Label>Document</Label>
              <Select value={documentId} onValueChange={setDocumentId} required>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {detail.documents.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.filename}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pointer-page">Page</Label>
              <Input
                id="pointer-page"
                type="number"
                min={1}
                value={page}
                onChange={(e) => setPage(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pointer-passage">Passage (copied verbatim)</Label>
            <Textarea
              id="pointer-passage"
              required
              minLength={10}
              rows={4}
              value={passage}
              onChange={(e) => setPassage(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pointer-note">Note (optional, not sent to the AI)</Label>
            <Input id="pointer-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || !ltoId || !documentId}>
              Send to the AI
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
