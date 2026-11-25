import { useQuery } from "@tanstack/react-query"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { useState, type SyntheticEvent } from "react"
import type { FrameworkDto, IndicatorDto } from "@shared/api"
import { keys } from "@/api/keys"
import { queries, useApiMutation } from "@/api/queries"
import { ConfirmButton } from "@/components/layout/ConfirmButton"
import { Loading, QueryError } from "@/components/layout/ErrorView"
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
import { useProgramme } from "@/hooks/useProgramme"
import { SettingsSection } from "./SettingsPage"

type Editing =
  | { type: "framework"; framework: FrameworkDto | null }
  | {
      type: "indicator"
      framework: FrameworkDto
      indicator: IndicatorDto | null
    }

export function FrameworksSettings() {
  const { programme } = useProgramme()
  const frameworks = useQuery(queries.frameworks(programme.id))
  const [editing, setEditing] = useState<Editing | null>(null)
  const invalidate = () => [keys.frameworks(programme.id), keys.justifications(programme.id)]
  const removeFramework = useApiMutation<FrameworkDto>({
    request: (f) => ({
      method: "DELETE",
      path: `/api/p/${programme.id}/frameworks/${f.id}`,
    }),
    invalidate,
    success: "Framework removed",
  })
  const removeIndicator = useApiMutation<IndicatorDto>({
    request: (i) => ({
      method: "DELETE",
      path: `/api/p/${programme.id}/indicators/${i.id}`,
    }),
    invalidate,
    success: "Indicator removed",
  })

  return (
    <SettingsSection
      title="Frameworks"
      description="Trajectory coordinators justify per indicator that an LTO is achieved. Dublin descriptors and the Bloom domains are included by default; add e.g. your programme's exit qualifications."
    >
      <Button size="sm" onClick={() => setEditing({ type: "framework", framework: null })}>
        <Plus /> Add framework
      </Button>
      {frameworks.error && <QueryError error={frameworks.error} />}
      {!frameworks.data && !frameworks.error && <Loading />}
      {frameworks.data?.map((framework) => (
        <div key={framework.id} className="rounded-xl border bg-card">
          <div className="flex items-start gap-2 border-b px-4 py-3">
            <div className="flex-1">
              <h3 className="font-semibold">{framework.name}</h3>
              {framework.description && (
                <p className="mt-0.5 text-sm text-muted-foreground">{framework.description}</p>
              )}
            </div>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Edit framework"
              onClick={() => setEditing({ type: "framework", framework })}
            >
              <Pencil />
            </Button>
            <ConfirmButton
              title={`Remove "${framework.name}"?`}
              description="All justifications written for its indicators are deleted."
              confirmLabel="Remove"
              onConfirm={() => removeFramework.mutate(framework)}
            >
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Remove framework"
                className="text-destructive"
              >
                <Trash2 />
              </Button>
            </ConfirmButton>
          </div>
          <ul className="divide-y">
            {framework.indicators.map((indicator) => (
              <li key={indicator.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                <span className="w-10 shrink-0 font-mono text-xs text-muted-foreground">
                  {indicator.code}
                </span>
                <div className="flex-1">
                  <p className="font-medium">{indicator.name}</p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {indicator.description}
                  </p>
                </div>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Edit indicator"
                  onClick={() => setEditing({ type: "indicator", framework, indicator })}
                >
                  <Pencil />
                </Button>
                <ConfirmButton
                  title={`Remove "${indicator.name}"?`}
                  description="Justifications written for it are deleted."
                  confirmLabel="Remove"
                  onConfirm={() => removeIndicator.mutate(indicator)}
                >
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Remove indicator"
                    className="text-destructive"
                  >
                    <Trash2 />
                  </Button>
                </ConfirmButton>
              </li>
            ))}
          </ul>
          <div className="px-4 py-2">
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setEditing({ type: "indicator", framework, indicator: null })}
            >
              <Plus /> Add indicator
            </Button>
          </div>
        </div>
      ))}
      {editing?.type === "framework" && (
        <FrameworkDialog framework={editing.framework} onClose={() => setEditing(null)} />
      )}
      {editing?.type === "indicator" && (
        <IndicatorDialog
          framework={editing.framework}
          indicator={editing.indicator}
          onClose={() => setEditing(null)}
        />
      )}
    </SettingsSection>
  )
}

function FrameworkDialog({
  framework,
  onClose,
}: {
  framework: FrameworkDto | null
  onClose: () => void
}) {
  const { programme } = useProgramme()
  const [name, setName] = useState(framework?.name ?? "")
  const [description, setDescription] = useState(framework?.description ?? "")
  const save = useApiMutation<undefined>({
    request: () =>
      framework
        ? {
            method: "PATCH",
            path: `/api/p/${programme.id}/frameworks/${framework.id}`,
            body: { name, description },
          }
        : {
            method: "POST",
            path: `/api/p/${programme.id}/frameworks`,
            body: { name, description },
          },
    invalidate: () => [keys.frameworks(programme.id)],
  })
  const submit = (event: SyntheticEvent) => {
    event.preventDefault()
    save.mutate(undefined, { onSuccess: onClose })
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{framework ? "Edit framework" : "New framework"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="fw-name">Name</Label>
            <Input
              id="fw-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Exit qualifications"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fw-description">Guidance for coordinators</Label>
            <Textarea
              id="fw-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
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

function IndicatorDialog({
  framework,
  indicator,
  onClose,
}: {
  framework: FrameworkDto
  indicator: IndicatorDto | null
  onClose: () => void
}) {
  const { programme } = useProgramme()
  const [code, setCode] = useState(indicator?.code ?? "")
  const [name, setName] = useState(indicator?.name ?? "")
  const [description, setDescription] = useState(indicator?.description ?? "")
  const save = useApiMutation<undefined>({
    request: () =>
      indicator
        ? {
            method: "PATCH",
            path: `/api/p/${programme.id}/indicators/${indicator.id}`,
            body: { code, name, description },
          }
        : {
            method: "POST",
            path: `/api/p/${programme.id}/frameworks/${framework.id}/indicators`,
            body: { code, name, description },
          },
    invalidate: () => [keys.frameworks(programme.id)],
  })
  const submit = (event: SyntheticEvent) => {
    event.preventDefault()
    save.mutate(undefined, { onSuccess: onClose })
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              {indicator ? "Edit indicator" : `New indicator in ${framework.name}`}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-[6rem_1fr] gap-3">
            <div className="space-y-2">
              <Label htmlFor="ind-code">Code</Label>
              <Input id="ind-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ind-name">Name</Label>
              <Input
                id="ind-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ind-description">Description</Label>
            <Textarea
              id="ind-description"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
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
