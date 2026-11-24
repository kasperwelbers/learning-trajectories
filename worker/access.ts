import { and, eq, inArray } from "drizzle-orm"
import { createMiddleware } from "hono/factory"
import {
  canEditCourse,
  canEditTrajectory,
  isMember,
  isProgrammeAdmin,
  type ProgrammeAccess,
  type RoleAssignment,
} from "@shared/roles"
import { readShareTokens } from "./auth/session"
import type { ProgrammeContext, ProgrammeEnv, SessionUser } from "./context"
import type { Db } from "./db/client"
import { programmeRoles, programmes, shareLinks } from "./db/schema"
import { forbidden, notFound, unauthorized } from "./errors"

type RoleRow = typeof programmeRoles.$inferSelect

export function toAssignment(row: Pick<RoleRow, "role" | "scopeId">): RoleAssignment {
  switch (row.role) {
    case "admin":
      return { role: "admin" }
    case "trajectory_coordinator":
      return { role: "trajectory_coordinator", trajectoryId: row.scopeId }
    case "course_coordinator":
      return { role: "course_coordinator", courseId: row.scopeId }
  }
}

export function scopeIdOf(assignment: RoleAssignment): number {
  switch (assignment.role) {
    case "admin":
      return 0
    case "trajectory_coordinator":
      return assignment.trajectoryId
    case "course_coordinator":
      return assignment.courseId
  }
}

export async function resolveAccess(
  db: Db,
  user: SessionUser | null,
  shareTokens: readonly string[],
  programmeId: string,
): Promise<ProgrammeAccess | null> {
  if (user?.isServerAdmin) return { kind: "server_admin" }
  if (user) {
    const rows = await db
      .select({ role: programmeRoles.role, scopeId: programmeRoles.scopeId })
      .from(programmeRoles)
      .where(and(eq(programmeRoles.programmeId, programmeId), eq(programmeRoles.userId, user.id)))
    if (rows.length > 0) return { kind: "member", roles: rows.map(toAssignment) }
  }
  if (shareTokens.length > 0) {
    const link = await db
      .select({ token: shareLinks.token })
      .from(shareLinks)
      .where(and(eq(shareLinks.programmeId, programmeId), inArray(shareLinks.token, [...shareTokens])))
      .get()
    if (link) return { kind: "share" }
  }
  return null
}

/** Resolves `access` for every route under /api/p/:pid. */
export const programmeAccess = createMiddleware<ProgrammeEnv>(async (c, next) => {
  const programmeId = c.req.param("pid")
  if (!programmeId) throw notFound("Programme not found")
  const db = c.get("db")
  const exists = await db
    .select({ id: programmes.id })
    .from(programmes)
    .where(eq(programmes.id, programmeId))
    .get()
  if (!exists) throw notFound("Programme not found")
  const user = c.get("user")
  const access = await resolveAccess(db, user, readShareTokens(c), programmeId)
  if (!access) throw user ? forbidden("You do not have access to this programme") : unauthorized()
  c.set("programmeId", programmeId)
  c.set("access", access)
  await next()
})

// ── Assertions used by route handlers ───────────────────────────────────────

export function requireAdmin(c: ProgrammeContext): void {
  if (!isProgrammeAdmin(c.get("access"))) throw forbidden("Only programme admins can do this")
}

export function requireMember(c: ProgrammeContext): void {
  if (!isMember(c.get("access"))) throw forbidden("Log in to see this")
}

export function requireTrajectoryEditor(c: ProgrammeContext, trajectoryId: number): void {
  if (!canEditTrajectory(c.get("access"), trajectoryId)) {
    throw forbidden("Only coordinators of this trajectory can edit it")
  }
}

export function requireCourseEditor(c: ProgrammeContext, courseId: number): void {
  if (!canEditCourse(c.get("access"), courseId)) {
    throw forbidden("Only coordinators of this course can do this")
  }
}

/** E-mail of the logged-in user (routes that change data always have one). */
export function actorEmail(c: ProgrammeContext): string {
  const user = c.get("user")
  if (!user) throw unauthorized()
  return user.email
}
