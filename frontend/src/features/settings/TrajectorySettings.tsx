import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
import { useState, type SyntheticEvent } from "react"
import type { TrajectoryDto } from "@shared/api"
import { keys } from "@/api/keys"
import { queries, useApiMutation } from "@/api/queries"
import { ConfirmButton } from "@/components/layout/ConfirmButton"
import { Loading, QueryError } from "@/components/layout/ErrorView"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useProgramme } from "@/hooks/useProgramme"
import { nextTrajectoryColor, TRAJECTORY_COLORS } from "@/lib/palette"
import { SettingsSection } from "./SettingsPage"

export function TrajectorySettings() {
  const { programme } = useProgramme()
  const structure = useQuery(queries.structure(programme.id))
  const [name, setName] = useState("")
  const invalidate = () => [keys.structure(programme.id)]

  const create = useApiMutation<{ name: string; color: string }, { id: number }>({
    request: (body) => ({ method: "POST", path: `/api/p/${programme.id}/trajectories`, body }),
    invalidate,
    success: "Trajectory added",
  })
  const order = useApiMutation<number[]>({
    request: (ids) => ({ method: "POST", path: `/api/p/${programme.id}/trajectories/order`, body: { ids } }),
    invalidate,
  })
  const recolor = useApiMutation<{ trajectory: TrajectoryDto; color: string }>({
    request: ({ trajectory, color }) => ({
      method: "PATCH",
      path: `/api/p/${programme.id}/trajectories/${trajectory.id}`,
      body: { color, version: trajectory.version },
    }),
    invalidate,
  })
  const remove = useApiMutation<TrajectoryDto>({
    request: (t) => ({ method: "DELETE", path: `/api/p/${programme.id}/trajectories/${t.id}` }),
    invalidate: () => [keys.structure(programme.id), ["p", programme.id, "coverage"]],
    success: "Trajectory deleted",
  })

  if (structure.error) return <QueryError error={structure.error} />
  if (!structure.data) return <Loading />
  const list = structure.data.trajectories

  const move = (index: number, delta: -1 | 1) => {
    const ids = list.map((t) => t.id)
    const a = ids[index]
    const b = ids[index + delta]
    if (a === undefined || b === undefined) return
    ids[index] = b
    ids[index + delta] = a
    order.mutate(ids)
  }
  const submit = (event: SyntheticEvent) => {
    event.preventDefault()
    create.mutate({ name, color: nextTrajectoryColor(list.map((t) => t.color)) }, { onSuccess: () => setName("") })
  }

  return (
    <SettingsSection
      title="Trajectories"
      description="Add, order and colour the learning trajectories. Narratives and LTOs are edited on each trajectory's own page."
    >
      <ul className="divide-y rounded-xl border bg-card">
        {list.map((t, i) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="flex gap-1">
              {TRAJECTORY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  onClick={() => recolor.mutate({ trajectory: t, color: c })}
                  className="size-4 rounded-full ring-offset-2 ring-offset-card data-[active=true]:ring-2 data-[active=true]:ring-foreground"
                  data-active={t.color.toLowerCase() === c}
                  style={{ background: c }}
                />
              ))}
            </div>
            <Link
              to="/p/$programmeId/trajectories/$trajectoryId"
              params={{ programmeId: programme.id, trajectoryId: String(t.id) }}
              search={(s) => ({ year: s.year })}
              className="flex-1 font-medium hover:underline"
            >
              {t.name}
            </Link>
            <span className="text-xs text-muted-foreground">{t.ltos.length} LTOs</span>
            <Button size="icon-xs" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp />
            </Button>
            <Button size="icon-xs" variant="ghost" aria-label="Move down" disabled={i === list.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown />
            </Button>
            <ConfirmButton
              title={`Delete "${t.name}"?`}
              description="All its LTOs, narratives, justifications and links to courses are deleted. This cannot be undone."
              onConfirm={() => remove.mutate(t)}
            >
              <Button size="icon-xs" variant="ghost" aria-label="Delete" className="text-destructive">
                <Trash2 />
              </Button>
            </ConfirmButton>
          </li>
        ))}
        {list.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">No trajectories yet.</li>}
      </ul>
      <form onSubmit={submit} className="flex max-w-md gap-2">
        <Input required placeholder="New trajectory name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={create.isPending}>
          <Plus /> Add
        </Button>
      </form>
    </SettingsSection>
  )
}
