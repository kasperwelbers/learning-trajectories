import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ArrowDown, ArrowUp, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import { useState, type SyntheticEvent } from "react"
import type { LtoDto, TrajectoryDto } from "@shared/api"
import { canEditTrajectory, isProgrammeAdmin } from "@shared/roles"
import { keys } from "@/api/keys"
import { queries, useApiMutation } from "@/api/queries"
import { FlowerLegend, FlowerRow } from "@/components/bloom/Flower"
import { ConfirmButton } from "@/components/layout/ConfirmButton"
import { Loading, NotFoundView, QueryError } from "@/components/layout/ErrorView"
import { EditableNarrative } from "@/components/markdown/EditableNarrative"
import { MarkdownView } from "@/components/markdown/MarkdownView"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useCoverage } from "@/hooks/useCoverage"
import { useProgramme } from "@/hooks/useProgramme"
import { trajectoryRoute } from "@/router"

export function TrajectoryPage() {
  const { programme } = useProgramme()
  const trajectoryId = Number(trajectoryRoute.useParams().trajectoryId)
  const structure = useQuery(queries.structure(programme.id))

  if (structure.error) return <QueryError error={structure.error} />
  if (!structure.data) return <Loading />
  const trajectory = structure.data.trajectories.find((t) => t.id === trajectoryId)
  if (!trajectory) return <NotFoundView />
  return <TrajectoryContent trajectory={trajectory} />
}

function TrajectoryContent({ trajectory }: { trajectory: TrajectoryDto }) {
  const { programme } = useProgramme()
  const coverage = useCoverage()
  const canEdit = canEditTrajectory(programme.access, trajectory.id)
  const [ltoDialog, setLtoDialog] = useState<LtoDto | "new" | null>(null)

  const update = useApiMutation<{
    narrative?: string
    name?: string
    color?: string
  }>({
    request: (body) => ({
      method: "PATCH",
      path: `/api/p/${programme.id}/trajectories/${trajectory.id}`,
      body: { ...body, version: trajectory.version },
    }),
    invalidate: () => [keys.structure(programme.id)],
  })
  const order = useApiMutation<number[]>({
    request: (ids) => ({
      method: "POST",
      path: `/api/p/${programme.id}/trajectories/${trajectory.id}/ltos/order`,
      body: { ids },
    }),
    invalidate: () => [keys.structure(programme.id)],
  })
  const remove = useApiMutation<LtoDto>({
    request: (lto) => ({
      method: "DELETE",
      path: `/api/p/${programme.id}/ltos/${lto.id}`,
    }),
    invalidate: () => [keys.structure(programme.id), ["p", programme.id, "coverage"]],
    success: "LTO deleted",
  })

  /** Swap an LTO with its neighbour. */
  const reorder = (index: number, delta: -1 | 1) => {
    const ids = trajectory.ltos.map((l) => l.id)
    const a = ids[index]
    const b = ids[index + delta]
    if (a === undefined || b === undefined) return
    ids[index] = b
    ids[index + delta] = a
    order.mutate(ids)
  }

  return (
    <div className="space-y-10">
      <header className="space-y-4">
        <div className="flex items-center gap-3">
          <span
            className="h-8 w-1.5 rounded-full"
            style={{ background: trajectory.color || "var(--primary)" }}
          />
          <p className="text-sm text-muted-foreground">Learning trajectory</p>
        </div>
        <TrajectoryTitle
          trajectory={trajectory}
          canEdit={canEdit}
          onSave={(name, color) => update.mutateAsync({ name, color })}
        />
        <div className="max-w-3xl">
          <EditableNarrative
            value={trajectory.narrative}
            canEdit={canEdit}
            onSave={(narrative) => update.mutateAsync({ narrative })}
            programmeId={programme.id}
            empty="No narrative yet."
            placeholder="What is this trajectory about, and how do students develop along it?"
          />
        </div>
      </header>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-2xl font-semibold">Outcomes</h2>
          <div className="flex items-center gap-4">
            <FlowerLegend className="hidden lg:flex" />
            {canEdit && (
              <Button size="sm" onClick={() => setLtoDialog("new")}>
                <Plus /> Add LTO
              </Button>
            )}
          </div>
        </div>
        {trajectory.ltos.length === 0 && (
          <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
            This trajectory has no outcomes yet.
          </p>
        )}
        <ol className="space-y-3">
          {trajectory.ltos.map((lto, index) => (
            <li key={lto.id} className="rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{lto.code}</span>
                    {lto.relinkPending && (
                      <span
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                        title="The links of this LTO are being updated after a change"
                      >
                        <RefreshCw className="size-3 animate-spin" /> updating links
                      </span>
                    )}
                  </div>
                  <Link
                    to="/p/$programmeId/ltos/$ltoId"
                    params={{
                      programmeId: programme.id,
                      ltoId: String(lto.id),
                    }}
                    search={(s) => s}
                    className="block font-serif text-lg leading-snug hover:underline"
                  >
                    {lto.title}
                  </Link>
                  {lto.narrative && (
                    <MarkdownView
                      markdown={lto.narrative}
                      className="line-clamp-3 text-sm text-muted-foreground"
                    />
                  )}
                </div>
                <FlowerRow coverage={coverage.data?.flowers.get(lto.id)} size={40} labels />
              </div>
              {canEdit && (
                <div className="mt-3 flex gap-1 border-t pt-3">
                  <Button size="xs" variant="ghost" onClick={() => setLtoDialog(lto)}>
                    <Pencil /> Edit
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Move up"
                    disabled={index === 0}
                    onClick={() => reorder(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Move down"
                    disabled={index === trajectory.ltos.length - 1}
                    onClick={() => reorder(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <ConfirmButton
                    title={`Delete ${lto.code}?`}
                    description="Its narrative, justifications and all links to courses are deleted. This cannot be undone."
                    onConfirm={() => remove.mutate(lto)}
                  >
                    <Button size="xs" variant="ghost" className="ml-auto text-destructive">
                      <Trash2 /> Delete
                    </Button>
                  </ConfirmButton>
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>
      {ltoDialog !== null && (
        <LtoDialog
          trajectory={trajectory}
          lto={ltoDialog === "new" ? null : ltoDialog}
          onClose={() => setLtoDialog(null)}
        />
      )}
    </div>
  )
}

function TrajectoryTitle({
  trajectory,
  canEdit,
  onSave,
}: {
  trajectory: TrajectoryDto
  canEdit: boolean
  onSave: (name: string, color: string) => Promise<unknown>
}) {
  const { programme } = useProgramme()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(trajectory.name)
  const [color, setColor] = useState(trajectory.color || "#3b6fb6")
  const admin = isProgrammeAdmin(programme.access)

  if (!editing) {
    return (
      <div className="flex items-start gap-2">
        <h1 className="text-4xl font-semibold">{trajectory.name}</h1>
        {canEdit && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Rename"
            className="mt-1.5"
            onClick={() => setEditing(true)}
          >
            <Pencil />
          </Button>
        )}
      </div>
    )
  }
  const submit = (event: SyntheticEvent) => {
    event.preventDefault()
    void onSave(name, color).then(() => setEditing(false))
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-11 max-w-xl font-serif text-2xl"
        required
        autoFocus
      />
      {admin && (
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded border"
          aria-label="Colour"
        />
      )}
      <Button type="submit" size="sm">
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </form>
  )
}

function LtoDialog({
  trajectory,
  lto,
  onClose,
}: {
  trajectory: TrajectoryDto
  lto: LtoDto | null
  onClose: () => void
}) {
  const { programme } = useProgramme()
  const [code, setCode] = useState(lto?.code ?? "")
  const [title, setTitle] = useState(lto?.title ?? "")
  const save = useApiMutation<{ code: string; title: string }, { ok: true } | { id: number }>({
    request: (body) =>
      lto
        ? {
            method: "PATCH",
            path: `/api/p/${programme.id}/ltos/${lto.id}`,
            body: { ...body, version: lto.version },
          }
        : {
            method: "POST",
            path: `/api/p/${programme.id}/trajectories/${trajectory.id}/ltos`,
            body,
          },
    invalidate: () => [keys.structure(programme.id)],
    success: lto ? "LTO saved" : "LTO added",
  })
  const submit = (event: SyntheticEvent) => {
    event.preventDefault()
    save.mutate({ code, title }, { onSuccess: onClose })
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              {lto ? `Edit ${lto.code}` : `New outcome in ${trajectory.name}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="lto-code">Code</Label>
            <Input
              id="lto-code"
              required
              maxLength={30}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. AS1"
              className="max-w-40"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lto-title">Outcome</Label>
            <Textarea
              id="lto-title"
              required
              rows={3}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="The student can …"
            />
            <p className="text-xs text-muted-foreground">
              Phrase it in Bloom style (an observable verb), without fixing a level. Explain it
              further in the narrative.
            </p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
