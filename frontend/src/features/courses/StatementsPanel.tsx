import { ChevronRight } from "lucide-react"
import type { CourseDetailResponse } from "@shared/api"
import { DOCUMENT_KIND_LABELS } from "@shared/evidence"
import { Quote } from "@/components/evidence/Quote"
import { useProgramme } from "@/hooks/useProgramme"

/** Everything extracted from the documents: learning statements, assessments and rubrics. */
export function StatementsPanel({ detail }: { detail: CourseDetailResponse }) {
  const { programme } = useProgramme()
  const analysis = detail.analysis
  if (!analysis || (analysis.statements.length === 0 && analysis.assessments.length === 0))
    return null

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Extracted from the documents</h2>
        <p className="text-sm text-muted-foreground">
          Verbatim statements about what students learn, do and are assessed on.
        </p>
      </div>
      {detail.documents.map((doc) => {
        const statements = analysis.statements.filter(
          (s) => s.documentId === doc.id && !s.fromPointer,
        )
        if (statements.length === 0) return null
        return (
          <details key={doc.id} className="group rounded-xl border bg-card">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3">
              <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
              <span className="font-medium">{DOCUMENT_KIND_LABELS[doc.kind]}</span>
              <span className="truncate text-sm text-muted-foreground">{doc.filename}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {statements.length} statements
              </span>
            </summary>
            <div className="space-y-4 border-t px-5 py-4">
              {statements.map((s) => (
                <Quote
                  key={s.id}
                  programmeId={programme.id}
                  quote={s.quote}
                  context={s.context}
                  kind={s.kind}
                  page={s.page}
                  verification={s.verification}
                  document={{
                    id: doc.id,
                    kind: doc.kind,
                    filename: doc.filename,
                  }}
                  assessedBy={s.assessedBy}
                />
              ))}
            </div>
          </details>
        )
      })}

      {analysis.assessments.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2 font-medium">Assessment</th>
                <th className="px-3 py-2 font-medium">Weight</th>
                <th className="px-3 py-2 font-medium">Grading</th>
              </tr>
            </thead>
            <tbody>
              {analysis.assessments.map((a) => (
                <tr key={a.id} className="border-b last:border-0">
                  <td className="px-4 py-2">{a.name}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {a.weight === null ? "–" : `${a.weight}%`}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{a.grading || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {analysis.rubrics.map((rubric) => (
        <details key={rubric.id} className="group rounded-xl border bg-card">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3">
            <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
            <span className="font-medium">Rubric: {rubric.assessment}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {rubric.criteria.length} criteria
            </span>
          </summary>
          <div className="overflow-x-auto border-t">
            <table className="w-full text-sm">
              <tbody>
                {rubric.criteria.map((c, i) => (
                  <tr key={i} className="border-b align-top last:border-0">
                    <td className="w-56 px-4 py-2">
                      <p className="font-medium">{c.criterion}</p>
                      <p className="text-xs text-muted-foreground">{c.description}</p>
                    </td>
                    {c.levels.map((l, j) => (
                      <td key={j} className="px-3 py-2 text-xs">
                        <p className="font-medium">{l.label}</p>
                        <p className="text-muted-foreground">{l.description}</p>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </section>
  )
}
