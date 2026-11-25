import { Pencil } from "lucide-react"
import { lazy, Suspense, useState } from "react"
import { Button } from "@/components/ui/button"
import { MarkdownView } from "./MarkdownView"

/** The editor is large; load it only when someone starts editing. */
const MarkdownEditor = lazy(() =>
  import("./MarkdownEditor").then((m) => ({ default: m.MarkdownEditor })),
)

interface EditableNarrativeProps {
  value: string
  canEdit: boolean
  /** Resolves when saved; rejects to keep the editor open (e.g. on a conflict). */
  onSave: (markdown: string) => Promise<unknown>
  programmeId: string
  empty: string
  placeholder?: string
}

/** Shows a narrative; coordinators can switch to the editor and save explicitly. */
export function EditableNarrative({
  value,
  canEdit,
  onSave,
  programmeId,
  empty,
  placeholder,
}: EditableNarrativeProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  if (draft === null) {
    return (
      <div className="group relative">
        <MarkdownView
          markdown={value}
          empty={canEdit ? `${empty} Click "Edit" to write it.` : empty}
        />
        {canEdit && (
          <Button variant="outline" size="xs" className="mt-3" onClick={() => setDraft(value)}>
            <Pencil /> Edit
          </Button>
        )}
      </div>
    )
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSave(draft)
      setDraft(null)
    } catch {
      // The mutation shows the error; keep the draft so nothing is lost.
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg border bg-muted" />}>
        <MarkdownEditor
          initial={value}
          onChange={setDraft}
          programmeId={programmeId}
          placeholder={placeholder}
          autoFocus
        />
      </Suspense>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
