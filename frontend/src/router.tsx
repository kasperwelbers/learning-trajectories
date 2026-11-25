import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
} from "@tanstack/react-router"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ErrorView, NotFoundView } from "@/components/layout/ErrorView"
import { ProgrammeLayout } from "@/components/layout/ProgrammeLayout"
import { HomePage } from "@/features/home/HomePage"
import { LoginPage } from "@/features/auth/LoginPage"
import { OverviewPage } from "@/features/programme/OverviewPage"
import { CoursesPage } from "@/features/courses/CoursesPage"
import { settingsTabs, type SettingsTab } from "@/features/settings/tabs"

const rootRoute = createRootRoute({
  component: () => (
    <TooltipProvider delayDuration={250}>
      <Outlet />
      <Toaster position="bottom-right" />
    </TooltipProvider>
  ),
  errorComponent: ErrorView,
  notFoundComponent: NotFoundView,
})

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (search: Record<string, unknown>): { share?: string } =>
    typeof search.share === "string" ? { share: search.share } : {},
  component: HomePage,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === "string" && search.redirect.startsWith("/")
      ? { redirect: search.redirect }
      : {},
  component: LoginPage,
})

const YEAR = /^\d{4}-\d{4}$/

/** All programme pages share `?year=`; without it, the programme's current year is used. */
export const programmeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$programmeId",
  validateSearch: (search: Record<string, unknown>): { year?: string } =>
    typeof search.year === "string" && YEAR.test(search.year) ? { year: search.year } : {},
  component: ProgrammeLayout,
})

const overviewRoute = createRoute({
  getParentRoute: () => programmeRoute,
  path: "/",
  component: OverviewPage,
})

export const trajectoryRoute = createRoute({
  getParentRoute: () => programmeRoute,
  path: "trajectories/$trajectoryId",
  component: lazyRouteComponent(
    () => import("@/features/trajectories/TrajectoryPage"),
    "TrajectoryPage",
  ),
})

export const ltoRoute = createRoute({
  getParentRoute: () => programmeRoute,
  path: "ltos/$ltoId",
  component: lazyRouteComponent(() => import("@/features/trajectories/LtoPage"), "LtoPage"),
})

const coursesRoute = createRoute({
  getParentRoute: () => programmeRoute,
  path: "courses",
  component: CoursesPage,
})

export const courseRoute = createRoute({
  getParentRoute: () => programmeRoute,
  path: "courses/$courseId",
  validateSearch: (search: Record<string, unknown>): { lto?: number } => {
    const lto = Number(search.lto)
    return Number.isInteger(lto) && lto > 0 ? { lto } : {}
  },
  component: lazyRouteComponent(() => import("@/features/courses/CoursePage"), "CoursePage"),
})

const journeyRoute = createRoute({
  getParentRoute: () => programmeRoute,
  path: "views/journey",
  component: lazyRouteComponent(() => import("@/features/views/JourneyView"), "JourneyView"),
})
const heatmapRoute = createRoute({
  getParentRoute: () => programmeRoute,
  path: "views/heatmap",
  component: lazyRouteComponent(() => import("@/features/views/HeatmapView"), "HeatmapView"),
})
const matrixRoute = createRoute({
  getParentRoute: () => programmeRoute,
  path: "views/matrix",
  component: lazyRouteComponent(() => import("@/features/views/MatrixView"), "MatrixView"),
})
const metadataRoute = createRoute({
  getParentRoute: () => programmeRoute,
  path: "views/metadata",
  component: lazyRouteComponent(() => import("@/features/views/MetadataView"), "MetadataView"),
})
const reportRoute = createRoute({
  getParentRoute: () => programmeRoute,
  path: "report",
  component: lazyRouteComponent(() => import("@/features/views/ReportView"), "ReportView"),
})

export const settingsRoute = createRoute({
  getParentRoute: () => programmeRoute,
  path: "settings",
  validateSearch: (search: Record<string, unknown>): { tab?: SettingsTab } => {
    const tab = settingsTabs.find((t) => t === search.tab)
    return tab ? { tab } : {}
  },
  component: lazyRouteComponent(() => import("@/features/settings/SettingsPage"), "SettingsPage"),
})

const routeTree = rootRoute.addChildren([
  homeRoute,
  loginRoute,
  programmeRoute.addChildren([
    overviewRoute,
    trajectoryRoute,
    ltoRoute,
    coursesRoute,
    courseRoute,
    journeyRoute,
    heatmapRoute,
    matrixRoute,
    metadataRoute,
    reportRoute,
    settingsRoute,
  ]),
])

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
