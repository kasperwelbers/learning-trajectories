import { Link } from "@tanstack/react-router"
import { isProgrammeAdmin } from "@shared/roles"
import { NotFoundView } from "@/components/layout/ErrorView"
import { useProgramme } from "@/hooks/useProgramme"
import { cn } from "@/lib/utils"
import { settingsRoute } from "@/router"
import { FieldsSettings } from "./FieldsSettings"
import { FrameworksSettings } from "./FrameworksSettings"
import { GeneralSettings } from "./GeneralSettings"
import { ImportSettings } from "./ImportSettings"
import { MembersSettings } from "./MembersSettings"
import { SharingSettings } from "./SharingSettings"
import { TrajectorySettings } from "./TrajectorySettings"

export const settingsTabs = ["general", "trajectories", "members", "sharing", "fields", "frameworks", "import"] as const
export type SettingsTab = (typeof settingsTabs)[number]

const TAB_LABELS: Record<SettingsTab, string> = {
  general: "General",
  trajectories: "Trajectories",
  members: "Members & roles",
  sharing: "Share links",
  fields: "Extracted information",
  frameworks: "Frameworks",
  import: "Import",
}

export function SettingsPage() {
  const { programme } = useProgramme()
  const { tab = "general" } = settingsRoute.useSearch()
  if (!isProgrammeAdmin(programme.access)) return <NotFoundView />

  return (
    <div className="grid gap-8 md:grid-cols-[13rem_1fr]">
      <nav className="flex gap-1 overflow-x-auto md:flex-col">
        <h1 className="mb-3 hidden text-2xl font-semibold md:block">Settings</h1>
        {settingsTabs.map((t) => (
          <Link
            key={t}
            to="/p/$programmeId/settings"
            params={{ programmeId: programme.id }}
            search={(s) => ({ year: s.year, tab: t })}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              tab === t && "bg-accent font-medium text-accent-foreground",
            )}
          >
            {TAB_LABELS[t]}
          </Link>
        ))}
      </nav>
      <div className="min-w-0">
        {tab === "general" && <GeneralSettings />}
        {tab === "trajectories" && <TrajectorySettings />}
        {tab === "members" && <MembersSettings />}
        {tab === "sharing" && <SharingSettings />}
        {tab === "fields" && <FieldsSettings />}
        {tab === "frameworks" && <FrameworksSettings />}
        {tab === "import" && <ImportSettings />}
      </div>
    </div>
  )
}

/** Consistent heading for a settings section. */
export function SettingsSection({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}
