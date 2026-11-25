import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { AlertTriangle, ChevronRight, Loader2, Play, RefreshCw, XCircle } from "lucide-react"
import type { AnalysisDto, CourseDetailResponse } from "@shared/api"
import { canEditCourse } from "@shared/roles"
import { keys } from "@/api/keys"
import { queries, useApiMutation } from "@/api/queries"
import { Loading, QueryError } from "@/components/layout/ErrorView"
import { Button } from "@/components/ui/button"
import { useProgramme } from "@/hooks/useProgramme"
import { formatDate } from "@/lib/format"
import { courseRoute } from "@/router"
import { ContributionsPanel } from "./ContributionsPanel"
import { DocumentsPanel } from "./DocumentsPanel"
import { HealthPanel } from "./HealthPanel"
import { StatementsPanel } from "./StatementsPanel"

export function CoursePage() {
  const { programme, year } = useProgramme()
  const courseId = Number(courseRoute.useParams().courseId)
  const detail = useQuery(queries.course(programme.id, courseId, year))
  if (detail.error) return <QueryError error={detail.error} />
  if (!detail.data) return <Loading />
  return <CourseContent detail={detail.data} />
}

function CourseContent({ detail }: { detail: CourseDetailResponse }) {
  const { programme, year } = useProgramme()
  const canEdit = canEditCourse(programme.access, detail.course.id)
  const analysis = detail.analysis
  const hasDescription = detail.documents.some(
    (d) => d.kind === "manual" || d.kind === "study_guide",
  )

  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <nav className="flex items-center gap-1 text-sm text-muted-foreground">
          <Link
            to="/p/$programmeId/courses"
            params={{ programmeId: programme.id }}
            search={(s) => ({ year: s.year })}
            className="hover:underline"
          >
            Courses
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="font-mono">{detail.course.code}</span>
        </nav>
        <h1 className="text-3xl font-semibold">{detail.course.name}</h1>
        <p className="text-sm text-muted-foreground">
          {detail.course.programmeYear ? `Year ${detail.course.programmeYear} · ` : ""}
          Academic year {year}
          {detail.documentYears.length > 0 && !detail.documentYears.includes(year) && (
            <> · documents available for {detail.documentYears.join(", ")}</>
          )}
        </p>
        <AnalysisBanner
          courseId={detail.course.id}
          analysis={analysis}
          canEdit={canEdit}
          hasDescription={hasDescription}
        />
      </header>

      <div className="grid gap-10 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-10">
          <ContributionsPanel detail={detail} canEdit={canEdit} />
          <HealthPanel detail={detail} />
          <StatementsPanel detail={detail} />
        </div>
        <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
          <DocumentsPanel detail={detail} canEdit={canEdit} />
        </aside>
      </div>
    </div>
  )
}

function AnalysisBanner({
  courseId,
  analysis,
  canEdit,
  hasDescription,
}: {
  courseId: number
  analysis: AnalysisDto | null
  canEdit: boolean
  hasDescription: boolean
}) {
  const { programme, year } = useProgramme()
  const run = useApiMutation<undefined>({
    request: () => ({
      method: "POST",
      path: `/api/p/${programme.id}/courses/${courseId}/analyze`,
      body: { year },
    }),
    invalidate: () => [keys.course(programme.id, courseId, year)],
    success: "Analysis started",
  })
  const runButton = (label: string, icon = <Play />) =>
    canEdit && hasDescription ? (
      <Button
        size="xs"
        variant="outline"
        disabled={run.isPending}
        onClick={() => run.mutate(undefined)}
      >
        {icon} {label}
      </Button>
    ) : null

  if (!analysis) {
    return (
      <Banner tone="muted">
        <span>
          {hasDescription
            ? "This course has not been analysed for this year yet."
            : "Add the study guide page or upload the course manual to analyse this course."}
        </span>
        {runButton("Analyse")}
      </Banner>
    )
  }
  if (analysis.status === "queued" || analysis.status === "running") {
    return (
      <Banner tone="muted">
        <Loader2 className="size-4 animate-spin" />
        <span>
          Analysing: {analysis.step ?? "queued"}… This takes a few minutes; the page updates by
          itself.
        </span>
      </Banner>
    )
  }
  if (analysis.status === "failed") {
    return (
      <Banner tone="error">
        <XCircle className="size-4" />
        <span>The analysis failed: {analysis.error ?? "unknown error"}</span>
        {runButton("Try again", <RefreshCw />)}
      </Banner>
    )
  }
  if (analysis.stale) {
    return (
      <Banner tone="warning">
        <AlertTriangle className="size-4" />
        <span>
          Documents or LTOs changed since this analysis. LTO changes are re-linked automatically;
          document changes need a new analysis.
        </span>
        {runButton("Re-analyse", <RefreshCw />)}
      </Banner>
    )
  }
  return (
    <p className="text-xs text-muted-foreground">
      Analysed {analysis.finishedAt ? formatDate(analysis.finishedAt) : ""}{" "}
      {analysis.model ? `with ${analysis.model}` : ""}
    </p>
  )
}

function Banner({
  tone,
  children,
}: {
  tone: "muted" | "warning" | "error"
  children: React.ReactNode
}) {
  const styles = {
    muted: "bg-muted text-foreground",
    warning: "bg-warning/10 text-foreground [&>svg]:text-warning",
    error: "bg-destructive/10 text-destructive",
  }
  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm ${styles[tone]}`}
    >
      {children}
    </div>
  )
}
