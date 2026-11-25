import { CircleCheck, CircleHelp, CircleX } from "lucide-react"
import type { CourseDetailResponse, MetadataValueDto } from "@shared/api"
import { formatFieldValue } from "@shared/fields"
import { SourceBadge, VerificationIcon } from "@/components/evidence/Badges"
import { useProgramme } from "@/hooks/useProgramme"

/** Effective status in the manual: values only found in the study guide count as missing. */
export function manualStatus(value: MetadataValueDto): MetadataValueDto["status"] {
  return value.source === "manual" ? value.status : "missing"
}

export function StatusIcon({ status }: { status: MetadataValueDto["status"] }) {
  if (status === "found") return <CircleCheck className="size-4 text-success" aria-label="found" />
  if (status === "unclear") return <CircleHelp className="size-4 text-warning" aria-label="unclear" />
  return <CircleX className="size-4 text-destructive" aria-label="missing" />
}

export function HealthPanel({ detail }: { detail: CourseDetailResponse }) {
  const { programme } = useProgramme()
  const analysis = detail.analysis
  if (!analysis || analysis.fields.length === 0) return null
  const hasManual = detail.documents.some((d) => d.kind === "manual")
  const problems = analysis.fields.filter((f) => f.required && manualStatus(f) !== "found")
  const manualDoc = detail.documents.find((d) => d.kind === "manual")
  const guideDoc = detail.documents.find((d) => d.kind === "study_guide")

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Course manual check</h2>
        <p className="text-sm text-muted-foreground">
          {!hasManual
            ? "No course manual uploaded yet; the values below come from the study guide."
            : problems.length === 0
              ? "The manual clearly states all required information."
              : `The manual is missing or unclear about ${problems.length} required item${problems.length === 1 ? "" : "s"}: ${problems.map((p) => p.label).join(", ")}.`}
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <tbody>
            {analysis.fields.map((field) => {
              const status = hasManual ? manualStatus(field) : field.status
              const doc = field.source === "manual" ? manualDoc : field.source === "study_guide" ? guideDoc : undefined
              return (
                <tr key={field.key} className="border-b align-top last:border-0">
                  <td className="w-8 py-3 pl-4">
                    <StatusIcon status={status} />
                  </td>
                  <td className="w-44 px-3 py-3">
                    <span className="font-medium">{field.label}</span>
                    {field.required && <span className="ml-1 text-xs text-muted-foreground">required</span>}
                  </td>
                  <td className="px-3 py-3">
                    <div>{formatFieldValue(field.value)}</div>
                    {field.quote && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <VerificationIcon verification={field.verification} />
                        <span className="italic">“{field.quote}”</span>
                        {doc && (
                          <a
                            href={`/api/p/${programme.id}/documents/${doc.id}/file${field.page ? `#page=${field.page}` : ""}`}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                          >
                            {field.page ? `p. ${field.page}` : "open"}
                          </a>
                        )}
                      </div>
                    )}
                    {field.status === "unclear" && <p className="mt-1 text-xs text-warning">The document is ambiguous about this.</p>}
                  </td>
                  <td className="w-36 py-3 pr-4 text-right">{field.source && <SourceBadge kind={field.source} />}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
