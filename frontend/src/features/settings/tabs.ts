/** Settings tabs; kept separate so the router can validate `?tab=` without loading the page. */
export const settingsTabs = [
  "general",
  "trajectories",
  "members",
  "sharing",
  "fields",
  "frameworks",
  "import",
] as const
export type SettingsTab = (typeof settingsTabs)[number]
