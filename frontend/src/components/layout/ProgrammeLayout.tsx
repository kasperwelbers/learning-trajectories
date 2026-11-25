import { useQuery } from "@tanstack/react-query"
import { Link, Navigate, Outlet, useNavigate } from "@tanstack/react-router"
import { ChevronDown, Eye, Radio, Settings } from "lucide-react"
import { useMemo } from "react"
import { isProgrammeAdmin } from "@shared/roles"
import { ApiError } from "@/api/client"
import { queries } from "@/api/queries"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useLiveUpdates } from "@/hooks/useLiveUpdates"
import { ProgrammeContext, useProgramme, type ProgrammeContextValue } from "@/hooks/useProgramme"
import { cn } from "@/lib/utils"
import { programmeRoute } from "@/router"
import { Loading, NotFoundView, QueryError } from "./ErrorView"
import { UserMenu } from "./UserMenu"

export function ProgrammeLayout() {
  const { programmeId } = programmeRoute.useParams()
  const search = programmeRoute.useSearch()
  const programme = useQuery(queries.programme(programmeId))
  const live = useLiveUpdates(programmeId)

  const value = useMemo<ProgrammeContextValue | null>(
    () =>
      programme.data
        ? { programme: programme.data, year: search.year ?? programme.data.currentYear, live }
        : null,
    [programme.data, search.year, live],
  )

  if (programme.error instanceof ApiError) {
    if (programme.error.status === 401) {
      return <Navigate to="/login" search={{ redirect: `/p/${programmeId}` }} />
    }
    if (programme.error.status === 404) return <NotFoundView />
  }
  if (programme.error) return <div className="p-8"><QueryError error={programme.error} /></div>
  if (!value) return <Loading />

  return (
    <ProgrammeContext.Provider value={value}>
      <div className="min-h-screen">
        <ProgrammeHeader />
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <Outlet />
        </main>
      </div>
    </ProgrammeContext.Provider>
  )
}

const navLink =
  "rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground data-[status=active]:bg-accent data-[status=active]:font-medium data-[status=active]:text-accent-foreground"

function ProgrammeHeader() {
  const { programme, year, live } = useProgramme()
  const { programmeId } = programmeRoute.useParams()
  const structure = useQuery(queries.structure(programmeId))
  const admin = isProgrammeAdmin(programme.access)
  const shared = programme.access.kind === "share"

  return (
    <header className="no-print sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:px-6">
        <Link
          to="/p/$programmeId"
          params={{ programmeId }}
          search={(s) => s}
          className="mr-3 truncate font-serif text-lg font-semibold tracking-tight"
          activeOptions={{ exact: true }}
        >
          {programme.name}
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          <Link to="/p/$programmeId" params={{ programmeId }} search={(s) => s} className={navLink} activeOptions={{ exact: true }}>
            Overview
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger className={cn(navLink, "flex items-center gap-1")}>
              Trajectories <ChevronDown className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              {structure.data?.trajectories.length === 0 && (
                <DropdownMenuLabel className="font-normal text-muted-foreground">No trajectories yet</DropdownMenuLabel>
              )}
              {structure.data?.trajectories.map((t) => (
                <DropdownMenuItem key={t.id} asChild>
                  <Link to="/p/$programmeId/trajectories/$trajectoryId" params={{ programmeId, trajectoryId: String(t.id) }} search={(s) => s}>
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: t.color || "var(--muted-foreground)" }} />
                    <span className="truncate">{t.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{t.ltos.length}</span>
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Link to="/p/$programmeId/courses" params={{ programmeId }} search={(s) => s} className={navLink}>
            Courses
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger className={cn(navLink, "flex items-center gap-1")}>
              Views <ChevronDown className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <ViewItem to="/p/$programmeId/views/journey" title="Trajectory journey" subtitle="Courses along the programme" />
              <ViewItem to="/p/$programmeId/views/heatmap" title="Bloom heatmap" subtitle="Where each LTO is taught and tested" />
              <ViewItem to="/p/$programmeId/views/matrix" title="Course × LTO matrix" subtitle="What each course contributes" />
              <ViewItem to="/p/$programmeId/views/metadata" title="Course manual check" subtitle="Extracted information per course" />
              <DropdownMenuSeparator />
              <ViewItem to="/p/$programmeId/report" title="Programme report" subtitle="Printable overview for committees" />
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <YearSelect years={programme.years} year={year} />
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
                <Radio className={cn("size-3.5", live.status === "live" ? "text-success" : "text-warning")} />
                {live.viewers > 1 && live.viewers}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {live.status === "live"
                ? `Live updates on${live.viewers > 1 ? ` · ${live.viewers} people viewing` : ""}`
                : "Reconnecting… changes by others appear after reconnecting"}
            </TooltipContent>
          </Tooltip>
          {admin && (
            <Button variant="ghost" size="icon-sm" asChild>
              <Link to="/p/$programmeId/settings" params={{ programmeId }} search={(s) => ({ year: s.year })} aria-label="Settings">
                <Settings />
              </Link>
            </Button>
          )}
          {shared ? (
            <span className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              <Eye className="size-3.5" /> View only
            </span>
          ) : (
            <UserMenu />
          )}
        </div>
      </div>
      <MobileNav />
    </header>
  )
}

type ViewPath =
  | "/p/$programmeId/views/journey"
  | "/p/$programmeId/views/heatmap"
  | "/p/$programmeId/views/matrix"
  | "/p/$programmeId/views/metadata"
  | "/p/$programmeId/report"

function ViewItem({ to, title, subtitle }: { to: ViewPath; title: string; subtitle: string }) {
  const { programmeId } = programmeRoute.useParams()
  return (
    <DropdownMenuItem asChild>
      <Link to={to} params={{ programmeId }} search={(s) => ({ year: s.year })} className="flex flex-col items-start gap-0">
        <span>{title}</span>
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      </Link>
    </DropdownMenuItem>
  )
}

function MobileNav() {
  const { programmeId } = programmeRoute.useParams()
  return (
    <nav className="flex gap-1 overflow-x-auto border-t px-3 py-1.5 md:hidden">
      <Link to="/p/$programmeId" params={{ programmeId }} search={(s) => s} className={navLink} activeOptions={{ exact: true }}>
        Overview
      </Link>
      <Link to="/p/$programmeId/courses" params={{ programmeId }} search={(s) => s} className={navLink}>
        Courses
      </Link>
      <Link to="/p/$programmeId/views/heatmap" params={{ programmeId }} search={(s) => ({ year: s.year })} className={navLink}>
        Heatmap
      </Link>
      <Link to="/p/$programmeId/views/journey" params={{ programmeId }} search={(s) => ({ year: s.year })} className={navLink}>
        Journey
      </Link>
      <Link to="/p/$programmeId/report" params={{ programmeId }} search={(s) => ({ year: s.year })} className={navLink}>
        Report
      </Link>
    </nav>
  )
}

function YearSelect({ years, year }: { years: string[]; year: string }) {
  const navigate = useNavigate()
  const { programme } = useProgramme()
  return (
    <Select
      value={year}
      onValueChange={(value) =>
        void navigate({
          to: ".",
          search: (prev: Record<string, unknown>) => ({ ...prev, year: value === programme.currentYear ? undefined : value }),
        })
      }
    >
      <SelectTrigger size="sm" className="w-[8.5rem]" aria-label="Academic year">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {years.map((y) => (
          <SelectItem key={y} value={y}>
            {y}
            {y === programme.currentYear && <span className="text-xs text-muted-foreground"> (current)</span>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
