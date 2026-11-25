import { useState, type SyntheticEvent } from "react"
import { keys } from "@/api/keys"
import { useApiMutation } from "@/api/queries"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useProgramme } from "@/hooks/useProgramme"
import { SettingsSection } from "./SettingsPage"

export function GeneralSettings() {
  const { programme } = useProgramme()
  const [name, setName] = useState(programme.name)
  const [currentYear, setCurrentYear] = useState(programme.currentYear)
  const [template, setTemplate] = useState(programme.studyGuideUrlTemplate)
  const save = useApiMutation<undefined>({
    request: () => ({
      method: "PATCH",
      path: `/api/p/${programme.id}`,
      body: { name, currentYear, studyGuideUrlTemplate: template, version: programme.version },
    }),
    invalidate: () => [keys.programme(programme.id), keys.programmes],
    success: "Settings saved",
  })
  const submit = (event: SyntheticEvent) => {
    event.preventDefault()
    save.mutate(undefined)
  }
  return (
    <SettingsSection title="General">
      <form onSubmit={submit} className="max-w-xl space-y-5">
        <div className="space-y-2">
          <Label htmlFor="name">Programme name</Label>
          <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="year">Current academic year</Label>
          <Input id="year" required pattern="\d{4}-\d{4}" value={currentYear} onChange={(e) => setCurrentYear(e.target.value)} className="max-w-40" />
          <p className="text-xs text-muted-foreground">Shown by default everywhere. Viewers can switch to other years.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="template">Study guide page per course</Label>
          <Input id="template" value={template} onChange={(e) => setTemplate(e.target.value)} placeholder="https://studiegids.vu.nl/en/courses/{year}/{code}" />
          <p className="text-xs text-muted-foreground">
            A URL with <code>{"{code}"}</code> and optionally <code>{"{year}"}</code>. Used to fetch each course&apos;s public description.
          </p>
          {!template && (
            <Button type="button" variant="link" size="xs" className="px-0" onClick={() => setTemplate("https://studiegids.vu.nl/en/courses/{year}/{code}")}>
              Use the VU study guide
            </Button>
          )}
        </div>
        <Button type="submit" disabled={save.isPending}>
          Save
        </Button>
      </form>
    </SettingsSection>
  )
}
