import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  AlertTriangle,
  CircleCheck,
  Download,
  FileQuestion,
  Loader2,
  MessageSquareWarning,
  Plus,
  Search,
  XCircle,
} from "lucide-react"
import { useMemo, useState, type SyntheticEvent } from "react"
import type { CourseSummaryDto, FetchStudyGuidesResponse } from "@shared/api"
import { isProgrammeAdmin } from "@shared/roles"
import { keys } from "@/api/keys"
import { queries, useApiMutation } from "@/api/queries"
import { Loading, QueryError } from "@/components/layout/ErrorView"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useProgramme } from "@/hooks/useProgramme"
import { formatPeriods } from "@/lib/format"

export function CoursesPage() {
  const { programme, year } = useProgramme()
  const courses = useQuery(queries.courses(programme.id, year))
  const admin = isProgrammeAdmin(programme.access)
  const [filter, setFilter] = useState("")

  const groups = useMemo(() => {
    const term = filter.trim().toLowerCase()
    const list = (courses.data?.courses ?? []).filter(
      (c) => !term || c.code.toLowerCase().includes(term) || c.name.toLowerCase().includes(term),
    )
    const byYear = new Map<number | null, CourseSummaryDto[]>()
    for (const course of list)
      byYear.set(course.programmeYear, [...(byYear.get(course.programmeYear) ?? []), course])
    return [...byYear.entries()]
      .sort(([a], [b]) => (a ?? 99) - (b ?? 99))
      .map(([programmeYear, items]) => ({
        programmeYear,
        items: items.sort(
          (a, b) => (a.periods[0] ?? 99) - (b.periods[0] ?? 99) || a.code.localeCompare(b.code),
        ),
      }))
  }, [courses.data, filter])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Courses</h1>
          <p className="mt-1 text-muted-foreground">
            Each course is analysed from its study guide page and course manual for {year}.
          </p>
        </div>
        {admin && (
          <div className="flex flex-wrap gap-2">
            {programme.studyGuideUrlTemplate && <FetchStudyGuidesButton />}
            <Button variant="outline" asChild>
              <Link
                to="/p/$programmeId/settings"
                params={{ programmeId: programme.id }}
                search={{ tab: "import" }}
              >
                Import courses
              </Link>
            </Button>
            <AddCourseDialog />
          </div>
        )}
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
        <Input
          placeholder="Search courses"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="pl-9"
        />
      </div>
      {courses.error && <QueryError error={courses.error} />}
      {!courses.data && !courses.error && <Loading />}
      {courses.data?.courses.length === 0 && (
        <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          No courses yet.
        </p>
      )}
      {groups.map((group) => (
        <section key={group.programmeYear ?? "none"} className="space-y-2">
          <h2 className="text-lg font-semibold">
            {group.programmeYear ? `Year ${group.programmeYear}` : "Year not set"}
          </h2>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="px-4 py-2 font-medium">Course</th>
                  <th className="px-3 py-2 font-medium">Period</th>
                  <th className="px-3 py-2 font-medium">EC</th>
                  <th className="px-3 py-2 font-medium">Analysis</th>
                  <th className="px-3 py-2 font-medium">Manual check</th>
                  <th className="px-3 py-2 text-right font-medium">Links</th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((course) => (
                  <CourseRow key={course.id} course={course} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}

function CourseRow({ course }: { course: CourseSummaryDto }) {
  const { programme, year } = useProgramme()
  return (
    <tr className="border-b last:border-0 hover:bg-muted/40">
      <td className="px-4 py-2.5">
        <Link
          to="/p/$programmeId/courses/$courseId"
          params={{ programmeId: programme.id, courseId: String(course.id) }}
          search={(s) => ({ year: s.year })}
          className="font-medium hover:underline"
        >
          <span className="mr-2 font-mono text-xs text-muted-foreground">{course.code}</span>
          {course.name}
        </Link>
        {course.analysisYear && course.analysisYear !== year && (
          <span className="ml-2 rounded-full bg-warning/15 px-2 py-0.5 text-xs">
            showing {course.analysisYear}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-muted-foreground">{formatPeriods(course.periods)}</td>
      <td className="px-3 py-2.5 text-muted-foreground tabular-nums">{course.ec ?? "–"}</td>
      <td className="px-3 py-2.5">
        <AnalysisStatus course={course} />
      </td>
      <td className="px-3 py-2.5">
        <HealthSummary course={course} />
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        <span className="inline-flex items-center gap-1.5">
          {course.openDisputes > 0 && (
            <span title={`${course.openDisputes} open dispute(s)`}>
              <MessageSquareWarning className="size-3.5 text-warning" />
            </span>
          )}
          {course.linkCount}
        </span>
      </td>
    </tr>
  )
}

function AnalysisStatus({ course }: { course: CourseSummaryDto }) {
  if (course.status === "running" || course.status === "queued") {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> {course.step ?? "queued"}
      </span>
    )
  }
  if (course.status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-destructive">
        <XCircle className="size-3.5" /> failed
      </span>
    )
  }
  if (!course.hasManual && !course.hasStudyGuide && !course.analysisYear) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <FileQuestion className="size-3.5" /> no documents
      </span>
    )
  }
  if (course.stale) {
    return (
      <span className="inline-flex items-center gap-1.5 text-warning">
        <AlertTriangle className="size-3.5" /> out of date
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-success">
      <CircleCheck className="size-3.5" /> up to date
    </span>
  )
}

function HealthSummary({ course }: { course: CourseSummaryDto }) {
  if (!course.health) {
    return <span className="text-muted-foreground">{course.hasManual ? "–" : "no manual"}</span>
  }
  const problems = course.health.requiredProblems
  if (problems.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-success">
        <CircleCheck className="size-3.5" /> complete
      </span>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger className="inline-flex items-center gap-1.5 text-warning">
        <AlertTriangle className="size-3.5" /> {problems.length} missing or unclear
      </TooltipTrigger>
      <TooltipContent>{problems.join(", ")}</TooltipContent>
    </Tooltip>
  )
}

function AddCourseDialog() {
  const { programme } = useProgramme()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [programmeYear, setProgrammeYear] = useState("")
  const create = useApiMutation<
    { code: string; name: string; programmeYear: number | null },
    { id: number }
  >({
    request: (body) => ({
      method: "POST",
      path: `/api/p/${programme.id}/courses`,
      body,
    }),
    invalidate: () => [["p", programme.id, "courses"]],
    success: "Course added",
  })
  const submit = (event: SyntheticEvent) => {
    event.preventDefault()
    create.mutate(
      {
        code,
        name,
        programmeYear: programmeYear ? Number(programmeYear) : null,
      },
      {
        onSuccess: () => {
          setOpen(false)
          setCode("")
          setName("")
        },
      },
    )
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Add course
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add a course</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <div className="space-y-2">
              <Label htmlFor="course-code">Code</Label>
              <Input
                id="course-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="S_AIS"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="course-year">Year</Label>
              <Input
                id="course-year"
                type="number"
                min={1}
                max={10}
                value={programmeYear}
                onChange={(e) => setProgrammeYear(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="course-name">Name</Label>
            <Input
              id="course-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function FetchStudyGuidesButton() {
  const { programme, year } = useProgramme()
  const fetchAll = useApiMutation<undefined, FetchStudyGuidesResponse>({
    request: () => ({
      method: "POST",
      path: `/api/p/${programme.id}/study-guides/fetch`,
      body: { year },
    }),
    invalidate: () => [["p", programme.id, "courses"], keys.programme(programme.id)],
    success: (r) =>
      r.failed.length === 0
        ? `Fetched ${r.fetched} study guide pages; changed courses are being analysed`
        : `Fetched ${r.fetched}; failed for ${r.failed.map((f) => f.code).join(", ")}`,
  })
  return (
    <Button
      variant="outline"
      disabled={fetchAll.isPending}
      onClick={() => fetchAll.mutate(undefined)}
    >
      {fetchAll.isPending ? <Loader2 className="animate-spin" /> : <Download />} Fetch study guides
    </Button>
  )
}
