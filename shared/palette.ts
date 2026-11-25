/**
 * Trajectory identity colours, in fixed order (validated categorical palette from the dataviz
 * guidelines). New trajectories take the next unused slot.
 */
export const TRAJECTORY_COLORS = [
  "#257de0",
  "#f47230",
  "#00b894",
  "#f2a600",
  "#ee7fac",
  "#008a17",
  "#6a4ce2",
  "#ec4647",
] as const

export function nextTrajectoryColor(used: readonly string[]): string {
  const taken = new Set(used.map((c) => c.toLowerCase()))
  return (
    TRAJECTORY_COLORS.find((c) => !taken.has(c)) ??
    TRAJECTORY_COLORS[used.length % TRAJECTORY_COLORS.length] ??
    "#257de0"
  )
}
