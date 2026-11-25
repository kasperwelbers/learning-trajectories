import { useQuery } from "@tanstack/react-query"
import { Lock, Pencil, Plus, Trash2 } from "lucide-react"
import { useState, type SyntheticEvent } from "react"
import type { FieldDto } from "@shared/api"
import { describeFieldType, type FieldType, type ScalarFieldType } from "@shared/fields"
import { keys } from "@/api/keys"
import { queries, useApiMutation } from "@/api/queries"
import { ConfirmButton } from "@/components/layout/ConfirmButton"
import { Loading, QueryError } from "@/components/layout/ErrorView"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useProgramme } from "@/hooks/useProgramme"
import { SettingsSection } from "./SettingsPage"

export function FieldsSettings() {
  const { programme } = useProgramme()
  const fields = useQuery(queries.fields(programme.id))
  const [editing, setEditing] = useState<FieldDto | "new" | null>(null)
  const remove = useApiMutation<FieldDto>({
    request: (f) => ({ method: "DELETE", path: `/api/p/${programme.id}/fields/${f.id}` }),
    invalidate: () => [keys.fields(programme.id)],
    success: "Field removed",
  })

  return (
    <SettingsSection
      title="Extracted information"
      description="What the AI extracts from every course manual (and study guide page). Required fields drive the course manual check. System fields are used by the standard views; their prompts can be tuned. Changes apply to the next analysis of each course."
    >
      <Button size="sm" onClick={() => setEditing("new")}>
        <Plus /> Add field
      </Button>
      {fields.error && <QueryError error={fields.error} />}
      {!fields.data && !fields.error && <Loading />}
      <ul className="divide-y rounded-xl border bg-card">
        {fields.data?.map((f) => (
          <li key={f.id} className="flex items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                {f.label}
                <span className="font-mono text-xs font-normal text-muted-foreground">{f.key}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[0.7rem] font-normal">{describeFieldType(f.type)}</span>
                {f.required && <span className="rounded-full bg-accent px-2 py-0.5 text-[0.7rem] font-normal text-accent-foreground">required</span>}
                {f.system && <Lock className="size-3 text-muted-foreground" aria-label="system field" />}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{f.prompt}</p>
            </div>
            <Button size="icon-xs" variant="ghost" aria-label="Edit" onClick={() => setEditing(f)}>
              <Pencil />
            </Button>
            {!f.system && (
              <ConfirmButton title={`Remove "${f.label}"?`} description="Existing results keep their value until the next analysis." confirmLabel="Remove" onConfirm={() => remove.mutate(f)}>
                <Button size="icon-xs" variant="ghost" aria-label="Remove" className="text-destructive">
                  <Trash2 />
                </Button>
              </ConfirmButton>
            )}
          </li>
        ))}
      </ul>
      {editing !== null && <FieldDialog field={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </SettingsSection>
  )
}

type ScalarKind = ScalarFieldType["kind"]
const SCALAR_KINDS: { value: ScalarKind; label: string }[] = [
  { value: "string", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes / no" },
  { value: "factor", label: "One of a list" },
]

function toScalar(kind: ScalarKind, levels: string): ScalarFieldType {
  if (kind === "factor") {
    return { kind, levels: levels.split(",").map((l) => l.trim()).filter((l) => l.length > 0) }
  }
  return { kind }
}

function FieldDialog({ field, onClose }: { field: FieldDto | null; onClose: () => void }) {
  const { programme } = useProgramme()
  const scalar: ScalarFieldType = field ? (field.type.kind === "array" ? field.type.of : field.type) : { kind: "string" }
  const [key, setKey] = useState(field?.key ?? "")
  const [label, setLabel] = useState(field?.label ?? "")
  const [prompt, setPrompt] = useState(field?.prompt ?? "")
  const [required, setRequired] = useState(field?.required ?? false)
  const [kind, setKind] = useState<ScalarKind>(scalar.kind)
  const [levels, setLevels] = useState(scalar.kind === "factor" ? scalar.levels.join(", ") : "")
  const [isList, setIsList] = useState(field?.type.kind === "array")
  const lockedType = field?.system ?? false

  const save = useApiMutation<{ type: FieldType }>({
    request: ({ type }) =>
      field
        ? { method: "PATCH", path: `/api/p/${programme.id}/fields/${field.id}`, body: { label, prompt, required, ...(lockedType ? {} : { type }) } }
        : { method: "POST", path: `/api/p/${programme.id}/fields`, body: { key, label, prompt, required, type } },
    invalidate: () => [keys.fields(programme.id)],
    success: "Field saved",
  })
  const submit = (event: SyntheticEvent) => {
    event.preventDefault()
    const base = toScalar(kind, levels)
    save.mutate({ type: isList ? { kind: "array", of: base } : base }, { onSuccess: onClose })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{field ? `Edit "${field.label}"` : "New field"}</DialogTitle>
            <DialogDescription>The AI answers with a value of this type, a verbatim quote and whether it was found, unclear or missing.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="field-label">Label</Label>
              <Input id="field-label" required value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="field-key">Key</Label>
              <Input
                id="field-key"
                required
                disabled={Boolean(field)}
                pattern="[a-z][a-z0-9_]*"
                value={key}
                onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
                placeholder="e.g. group_work"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={kind} onValueChange={(v) => setKind(SCALAR_KINDS.find((k) => k.value === v)?.value ?? "string")} disabled={lockedType}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCALAR_KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={isList} disabled={lockedType} onChange={(e) => setIsList(e.target.checked)} />
              A list of these
            </label>
          </div>
          {kind === "factor" && (
            <div className="space-y-2">
              <Label htmlFor="field-levels">Allowed values (comma-separated)</Label>
              <Input id="field-levels" required disabled={lockedType} value={levels} onChange={(e) => setLevels(e.target.value)} placeholder="written exam, oral exam, report, presentation" />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="field-prompt">Instruction for the AI</Label>
            <Textarea id="field-prompt" required rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What exactly should be extracted?" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            Required: every course manual should state this clearly
          </label>
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
