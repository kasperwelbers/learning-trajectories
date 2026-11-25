import { Pencil } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { MarkdownEditor } from "./MarkdownEditor"
import { MarkdownView } from "./MarkdownView"

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
      <MarkdownEditor
        initial={value}
        onChange={setDraft}
        programmeId={programmeId}
        placeholder={placeholder}
        autoFocus
      />
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
