import { useQueryClient } from "@tanstack/react-query"
import { FileUp, Loader2, Search } from "lucide-react"
import Papa from "papaparse"
import { useMemo, useRef, useState, type SyntheticEvent } from "react"
import { toast } from "sonner"
import type { ImportLtosResponse, ImportPreviewResponse, ProposedCourseDto } from "@shared/api"
import { apiSend, errorMessage } from "@/api/client"
import { keys } from "@/api/keys"
import { useApiMutation } from "@/api/queries"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useProgramme } from "@/hooks/useProgramme"
import { formatPeriods } from "@/lib/format"
import { SettingsSection } from "./SettingsPage"

export function ImportSettings() {
  return (
    <div className="space-y-12">
      <CourseImport />
      <LtoImport />
    </div>
  )
}

// ── Courses from web pages ──────────────────────────────────────────────────

const VU_COURSE_TEMPLATE = "https://studiegids.vu.nl/en/courses/{year}/{code}"

function CourseImport() {
  const { programme } = useProgramme()
  const queryClient = useQueryClient()
  const [urls, setUrls] = useState("")
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const load = async (event: SyntheticEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      const list = urls.split(/\s+/).map((u) => u.trim()).filter((u) => u.length > 0)
      const result = await apiSend<ImportPreviewResponse>("POST", `/api/p/${programme.id}/courses/import-preview`, { urls: list })
      setPreview(result)
      setSelected(new Set(result.courses.filter((c) => c.suggested && !c.exists).map((c) => c.code)))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    if (!preview) return
    setBusy(true)
    try {
      const courses = preview.courses
        .filter((c) => selected.has(c.code) && !c.exists)
        .map((c) => ({ code: c.code, name: c.name, programmeYear: c.programmeYear }))
      const { created } = await apiSend<{ created: number }>("POST", `/api/p/${programme.id}/courses/bulk`, { courses })
      const fromVu = preview.courses.some((c) => c.url?.startsWith("https://studiegids.vu.nl/"))
      if (fromVu && !programme.studyGuideUrlTemplate) {
        await apiSend("PATCH", `/api/p/${programme.id}`, { studyGuideUrlTemplate: VU_COURSE_TEMPLATE, version: programme.version })
      }
      toast.success(`${created} courses added${fromVu ? ". Use “Fetch study guides” on the courses page to analyse them." : ""}`)
      setPreview(null)
      await queryClient.invalidateQueries({ queryKey: ["p", programme.id] })
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsSection
      title="Import courses from web pages"
      description={
        <>
          Paste the address of the programme&apos;s page in the online study guide (VU study guide pages are read exactly; other pages are read by the AI).
          You choose which courses to add.
        </>
      }
    >
      <form onSubmit={(e) => void load(e)} className="flex max-w-2xl flex-col gap-2 sm:flex-row">
        <Textarea
          rows={2}
          required
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          placeholder="https://studiegids.vu.nl/en/Bachelor/2026-2027/communication-science"
          className="flex-1"
        />
        <Button type="submit" disabled={busy} className="self-start">
          {busy ? <Loader2 className="animate-spin" /> : <Search />} Find courses
        </Button>
      </form>
      {preview && <CoursePreview preview={preview} selected={selected} onChange={setSelected} onCreate={() => void create()} busy={busy} />}
    </SettingsSection>
  )
}

function CoursePreview({
  preview,
  selected,
  onChange,
  onCreate,
  busy,
}: {
  preview: ImportPreviewResponse
  selected: Set<string>
  onChange: (next: Set<string>) => void
  onCreate: () => void
  busy: boolean
}) {
  const groups = useMemo(() => {
    const map = new Map<string, ProposedCourseDto[]>()
    for (const c of preview.courses) map.set(c.group || "Courses", [...(map.get(c.group || "Courses") ?? []), c])
    return [...map.entries()]
  }, [preview])
  const toggle = (codes: string[], on: boolean) => {
    const next = new Set(selected)
    for (const code of codes) {
      if (on) next.add(code)
      else next.delete(code)
    }
    onChange(next)
  }
  const failed = preview.sources.filter((s) => !s.ok)
  const newSelected = preview.courses.filter((c) => selected.has(c.code) && !c.exists).length

  return (
    <div className="space-y-3">
      {failed.map((s) => (
        <p key={s.url} className="text-sm text-destructive">
          {s.url}: {s.error}
        </p>
      ))}
      <p className="text-sm text-muted-foreground">
        Found {preview.courses.length} courses. Regular courses of the programme are pre-selected; minors and electives are not.
      </p>
      <div className="max-h-[32rem] overflow-y-auto rounded-xl border bg-card">
        {groups.map(([group, courses]) => (
          <div key={group} className="border-b last:border-0">
            <label className="sticky top-0 flex items-center gap-2 bg-muted px-4 py-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={courses.every((c) => c.exists || selected.has(c.code))}
                onChange={(e) => toggle(courses.filter((c) => !c.exists).map((c) => c.code), e.target.checked)}
              />
              {group}
            </label>
            {courses.map((c) => (
              <label key={c.code} className="flex items-center gap-3 px-4 py-1.5 text-sm hover:bg-muted/40">
                <input type="checkbox" disabled={c.exists} checked={c.exists || selected.has(c.code)} onChange={(e) => toggle([c.code], e.target.checked)} />
                <span className="w-24 font-mono text-xs text-muted-foreground">{c.code}</span>
                <span className="flex-1">{c.name}</span>
                <span className="text-xs text-muted-foreground">
                  {c.programmeYear ? `Year ${c.programmeYear} · ` : ""}
                  {formatPeriods(c.periods)}
                  {c.ec ? ` · ${c.ec} EC` : ""}
                </span>
                {c.exists && <span className="text-xs text-muted-foreground">already added</span>}
              </label>
            ))}
          </div>
        ))}
      </div>
      <Button onClick={onCreate} disabled={busy || newSelected === 0}>
        Add {newSelected} courses
      </Button>
    </div>
  )
}

// ── LTOs from CSV ───────────────────────────────────────────────────────────

interface LtoRow {
  trajectory: string
  code: string
  title: string
}

/** Accepts the prototype's export (trajectory,name,outcome) and similar column names. */
export function parseLtoCsv(text: string): { rows: LtoRow[]; error: string | null } {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true })
  const pick = (row: Record<string, string>, names: string[]) => {
    for (const name of names) {
      const key = Object.keys(row).find((k) => k.trim().toLowerCase() === name)
      const value = key ? row[key]?.trim() : undefined
      if (value) return value
    }
    return ""
  }
  const rows = parsed.data
    .map((row) => ({
      trajectory: pick(row, ["trajectory", "trajectory name"]),
      code: pick(row, ["code", "name", "lto"]),
      title: pick(row, ["title", "outcome", "description"]),
    }))
    .filter((r) => r.trajectory && r.code && r.title)
  if (rows.length === 0) return { rows, error: "No rows found. The CSV needs columns trajectory, code (or name) and title (or outcome)." }
  return { rows, error: null }
}

function LtoImport() {
  const { programme } = useProgramme()
  const input = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<LtoRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const importLtos = useApiMutation<LtoRow[], ImportLtosResponse>({
    request: (list) => ({ method: "POST", path: `/api/p/${programme.id}/ltos/import`, body: { rows: list } }),
    invalidate: () => [keys.structure(programme.id)],
    success: (r) => `Created ${r.trajectoriesCreated} trajectories and ${r.ltosCreated} LTOs; updated ${r.ltosUpdated} LTOs`,
  })

  const read = async (file: File) => {
    const result = parseLtoCsv(await file.text())
    setRows(result.rows)
    setError(result.error)
  }

  return (
    <SettingsSection
      title="Import LTOs from CSV"
      description="Columns: trajectory, code (or name) and title (or outcome). Existing LTOs with the same code are updated; other columns (such as a Bloom level) are ignored."
    >
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={() => input.current?.click()}>
          <FileUp /> Choose CSV file
        </Button>
        <Input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void read(file)
            e.target.value = ""
          }}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {rows && rows.length > 0 && (
        <div className="space-y-3">
          <div className="max-h-80 overflow-y-auto rounded-xl border bg-card text-sm">
            <table className="w-full">
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b align-top last:border-0">
                    <td className="w-48 px-3 py-1.5 text-muted-foreground">{r.trajectory}</td>
                    <td className="w-24 px-3 py-1.5 font-mono text-xs">{r.code}</td>
                    <td className="px-3 py-1.5">{r.title}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button disabled={importLtos.isPending} onClick={() => importLtos.mutate(rows, { onSuccess: () => setRows(null) })}>
            Import {rows.length} LTOs
          </Button>
        </div>
      )}
    </SettingsSection>
  )
}
