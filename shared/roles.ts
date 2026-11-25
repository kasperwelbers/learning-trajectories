import { z } from "zod"

export const ROLES = ["admin", "trajectory_coordinator", "course_coordinator"] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Programme admin",
  trajectory_coordinator: "Trajectory coordinator",
  course_coordinator: "Course coordinator",
}

export const roleAssignmentSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("admin") }),
  z.object({
    role: z.literal("trajectory_coordinator"),
    trajectoryId: z.number().int(),
  }),
  z.object({
    role: z.literal("course_coordinator"),
    courseId: z.number().int(),
  }),
])
export type RoleAssignment = z.infer<typeof roleAssignmentSchema>

/** How the current viewer has access to a programme. */
export type ProgrammeAccess =
  { kind: "server_admin" } | { kind: "member"; roles: RoleAssignment[] } | { kind: "share" }

function hasRole(access: ProgrammeAccess, predicate: (r: RoleAssignment) => boolean): boolean {
  return access.kind === "member" && access.roles.some(predicate)
}

export function isProgrammeAdmin(access: ProgrammeAccess): boolean {
  return access.kind === "server_admin" || hasRole(access, (r) => r.role === "admin")
}

export function canEditTrajectory(access: ProgrammeAccess, trajectoryId: number): boolean {
  return (
    isProgrammeAdmin(access) ||
    hasRole(access, (r) => r.role === "trajectory_coordinator" && r.trajectoryId === trajectoryId)
  )
}

export function canEditCourse(access: ProgrammeAccess, courseId: number): boolean {
  return (
    isProgrammeAdmin(access) ||
    hasRole(access, (r) => r.role === "course_coordinator" && r.courseId === courseId)
  )
}

/** Logged-in members can see member-only information such as who coordinates what. */
export function isMember(access: ProgrammeAccess): boolean {
  return access.kind !== "share"
}
