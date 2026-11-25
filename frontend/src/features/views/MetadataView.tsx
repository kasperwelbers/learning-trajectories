import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Globe } from "lucide-react"
import { useMemo, useState } from "react"
import type { MetadataValueDto } from "@shared/api"
import { formatFieldValue } from "@shared/fields"
import { queries } from "@/api/queries"
import { Loading, QueryError } from "@/components/layout/ErrorView"
import { StatusIcon, manualStatus } from "@/features/courses/HealthPanel"
import { useProgramme } from "@/hooks/useProgramme"
import { compareCourses } from "@/lib/curriculum"
import { FilterToggle, ViewHeader } from "./ViewHeader"

export function MetadataView() {
  const { programme, year } = useProgramme()
  const table = useQuery(queries.metadata(programme.id, year))
  const [requiredOnly, setRequiredOnly] = useState(false)

  const fields = useMemo(() => (table.data?.fields ?? []).filter((f) => !requiredOnly || f.required), [table.data, requiredOnly])
  const rows = useMemo(() => [...(table.data?.rows ?? [])].sort((a, b) => compareCourses(a.course, b.course)), [table.data])
  const foundCount = (key: string) =>
    rows.filter((r) => {
      const v = r.values[key]
      return v && manualStatus(v) === "found"
    }).length

  return (
    <div className="space-y-6">
      <ViewHeader
        title="Course manual check"
        description="What the AI extracted from every course manual. A green check means the manual states it clearly; values that only the study guide provides are marked with a globe and count as missing from the manual."
      >
        <FilterToggle checked={requiredOnly} onChange={setRequiredOnly}>
          Only required information
        </FilterToggle>
      </ViewHeader>
      {table.error && <QueryError error={table.error} />}
      {!table.data && !table.error && <Loading />}
      {table.data && (
        <div className="max-h-[80vh] overflow-auto rounded-xl border bg-card">
          <table className="text-xs">
            <thead className="sticky top-0 z-10 bg-card">
              <tr>
                <th className="sticky left-0 z-20 border-b bg-card px-3 py-2 text-left font-medium">Course</th>
                {fields.map((f) => (
                  <th key={f.key} className="min-w-36 border-b px-3 py-2 text-left font-medium">
                    {f.label}
                    {f.required && <span className="ml-1 font-normal text-muted-foreground">*</span>}
                    <span className="block font-normal text-muted-foreground">
                      {foundCount(f.key)} / {rows.length} in manual
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ course, values }) => (
                <tr key={course.id} className="align-top hover:bg-muted/40">
                  <th className="sticky left-0 z-10 max-w-64 border-b bg-card px-3 py-2 text-left font-normal">
                    <Link
                      to="/p/$programmeId/courses/$courseId"
                      params={{ programmeId: programme.id, courseId: String(course.id) }}
                      search={(s) => ({ year: s.year })}
                      className="block truncate hover:underline"
                      title={course.name}
                    >
                      <span className="mr-1.5 font-mono text-muted-foreground">{course.code}</span>
                      {course.name}
                    </Link>
                    {course.analysisYear && course.analysisYear !== year && (
                      <span className="text-[0.7rem] text-warning">from {course.analysisYear}</span>
                    )}
                  </th>
                  {fields.map((f) => (
                    <td key={f.key} className="border-b px-3 py-2">
                      <Cell value={values[f.key]} analysed={Boolean(course.analysisYear)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Cell({ value, analysed }: { value: MetadataValueDto | undefined; analysed: boolean }) {
  if (!analysed || !value) return <span className="text-muted-foreground">–</span>
  const status = manualStatus(value)
  return (
    <span className="flex items-start gap-1.5" title={value.quote ? `“${value.quote}”${value.page ? ` (p. ${value.page})` : ""}` : undefined}>
      <span className="mt-px shrink-0">
        <StatusIcon status={status} />
      </span>
      <span className="line-clamp-3">
        {value.value === null ? <span className="text-muted-foreground">{value.status}</span> : formatFieldValue(value.value)}
      </span>
      {value.source === "study_guide" && (
        <span title="Only found in the study guide">
          <Globe className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
        </span>
      )}
    </span>
  )
}
