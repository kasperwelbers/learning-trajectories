import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ExternalLink, FileUp, Globe, Info, Loader2, Trash2 } from "lucide-react"
import { useRef, useState, type SyntheticEvent } from "react"
import { toast } from "sonner"
import type { CourseDetailResponse, DocumentDto } from "@shared/api"
import { DOCUMENT_KIND_LABELS, type DocumentKind } from "@shared/evidence"
import { apiUpload, errorMessage } from "@/api/client"
import { useApiMutation } from "@/api/queries"
import { ConfirmButton } from "@/components/layout/ConfirmButton"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useProgramme } from "@/hooks/useProgramme"
import { formatBytes, formatDate } from "@/lib/format"

const ACCEPT = ".pdf,.docx,.txt,.md,.html"

export function DocumentsPanel({ detail, canEdit }: { detail: CourseDetailResponse; canEdit: boolean }) {
  const byKind = (kind: DocumentKind) => detail.documents.filter((d) => d.kind === kind)
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">Course documents</h2>
      <StudyGuideSection detail={detail} documents={byKind("study_guide")} canEdit={canEdit} />
      <UploadSection
        detail={detail}
        kind="manual"
        documents={byKind("manual")}
        canEdit={canEdit}
        hint="The official course manual for this year. It is the source for the manual check; uploading a new one replaces the old one and starts a new analysis."
      />
      <UploadSection
        detail={detail}
        kind="supplementary"
        documents={byKind("supplementary")}
        canEdit={canEdit}
        multiple
        hint="Optional: rubrics, assignment instructions and other material. Evidence from these files is labelled as such. Run the analysis again after adding files."
      />
      <CanvasTip />
    </section>
  )
}

function useInvalidateCourse(courseId: number) {
  const { programme, year } = useProgramme()
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["p", programme.id, "course", courseId, year] }),
      queryClient.invalidateQueries({ queryKey: ["p", programme.id, "courses"] }),
    ])
}

function StudyGuideSection({ detail, documents, canEdit }: { detail: CourseDetailResponse; documents: DocumentDto[]; canEdit: boolean }) {
  const { programme, year } = useProgramme()
  const suggested = programme.studyGuideUrlTemplate
    ? programme.studyGuideUrlTemplate.replaceAll("{code}", encodeURIComponent(detail.course.code)).replaceAll("{year}", year)
    : ""
  const [url, setUrl] = useState(documents[0]?.sourceUrl ?? suggested)
  const invalidate = useInvalidateCourse(detail.course.id)
  const fetchGuide = useApiMutation<string>({
    request: (value) => ({ method: "POST", path: `/api/p/${programme.id}/courses/${detail.course.id}/study-guide`, body: { year, url: value } }),
    success: "Study guide page fetched; the course is being analysed",
  })
  const submit = (event: SyntheticEvent) => {
    event.preventDefault()
    fetchGuide.mutate(url, { onSuccess: () => void invalidate() })
  }
  return (
    <div className="space-y-2 border-t pt-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <Globe className="size-4 text-muted-foreground" /> {DOCUMENT_KIND_LABELS.study_guide}
      </h3>
      {documents.map((doc) => (
        <DocumentItem key={doc.id} doc={doc} courseId={detail.course.id} canEdit={canEdit} />
      ))}
      {documents.length === 0 && <p className="text-xs text-muted-foreground">The public course description, fetched from a web page.</p>}
      {canEdit && (
        <form onSubmit={submit} className="flex gap-2">
          <Input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="h-8 text-xs" />
          <Button type="submit" size="sm" variant="outline" disabled={fetchGuide.isPending}>
            {fetchGuide.isPending ? <Loader2 className="animate-spin" /> : documents.length ? "Refresh" : "Fetch"}
          </Button>
        </form>
      )}
    </div>
  )
}

function UploadSection({
  detail,
  kind,
  documents,
  canEdit,
  multiple = false,
  hint,
}: {
  detail: CourseDetailResponse
  kind: DocumentKind
  documents: DocumentDto[]
  canEdit: boolean
  multiple?: boolean
  hint: string
}) {
  const { programme, year } = useProgramme()
  const input = useRef<HTMLInputElement>(null)
  const invalidate = useInvalidateCourse(detail.course.id)
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        const form = new FormData()
        form.append("file", file)
        form.append("year", year)
        form.append("kind", kind)
        await apiUpload(`/api/p/${programme.id}/courses/${detail.course.id}/documents`, form)
      }
    },
    onSuccess: async (_r, files) => {
      toast.success(kind === "manual" ? "Manual uploaded; the course is being analysed" : `${files.length} file(s) uploaded`)
      await invalidate()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  return (
    <div className="space-y-2 border-t pt-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <FileUp className="size-4 text-muted-foreground" /> {DOCUMENT_KIND_LABELS[kind]}
      </h3>
      {documents.map((doc) => (
        <DocumentItem key={doc.id} doc={doc} courseId={detail.course.id} canEdit={canEdit} />
      ))}
      <p className="text-xs text-muted-foreground">{hint}</p>
      {canEdit && (
        <>
          <Button size="sm" variant="outline" disabled={upload.isPending} onClick={() => input.current?.click()}>
            {upload.isPending ? <Loader2 className="animate-spin" /> : <FileUp />}
            {kind === "manual" && documents.length > 0 ? "Replace manual" : multiple ? "Add files" : "Upload"}
          </Button>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            multiple={multiple}
            className="hidden"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              if (files.length > 0) upload.mutate(files)
              e.target.value = ""
            }}
          />
        </>
      )}
    </div>
  )
}

function DocumentItem({ doc, courseId, canEdit }: { doc: DocumentDto; courseId: number; canEdit: boolean }) {
  const { programme } = useProgramme()
  const invalidate = useInvalidateCourse(courseId)
  const remove = useApiMutation<undefined>({
    request: () => ({ method: "DELETE", path: `/api/p/${programme.id}/documents/${doc.id}` }),
    success: "Document removed",
  })
  return (
    <div className="flex items-start gap-2 rounded-md bg-muted/50 px-2.5 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <a href={`/api/p/${programme.id}/documents/${doc.id}/file`} target="_blank" rel="noreferrer" className="block truncate hover:underline">
          {doc.filename}
        </a>
        <p className="text-xs text-muted-foreground">
          {formatBytes(doc.size)} · {formatDate(doc.uploadedAt)}
          {doc.uploadedBy ? ` · ${doc.uploadedBy}` : ""}
        </p>
        {doc.sourceUrl && (
          <a href={doc.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
            source <ExternalLink className="size-3" />
          </a>
        )}
      </div>
      {canEdit && (
        <ConfirmButton
          title="Remove this document?"
          description="Evidence taken from it disappears until the course is analysed again."
          confirmLabel="Remove"
          onConfirm={() => remove.mutate(undefined, { onSuccess: () => void invalidate() })}
        >
          <Button size="icon-xs" variant="ghost" aria-label="Remove document">
            <Trash2 />
          </Button>
        </ConfirmButton>
      )}
    </div>
  )
}

function CanvasTip() {
  return (
    <details className="border-t pt-3 text-xs text-muted-foreground">
      <summary className="flex cursor-pointer items-center gap-1.5 font-medium">
        <Info className="size-3.5" /> Getting material out of Canvas
      </summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Files: open <em>Files</em>, select files and choose <em>Download</em>.</li>
        <li>Pages and assignment descriptions: open the page and print it to PDF (Ctrl/Cmd + P → Save as PDF).</li>
        <li>Rubrics: open the assignment, show the rubric and print to PDF.</li>
      </ul>
    </details>
  )
}
