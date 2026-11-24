import { and, eq } from "drizzle-orm"
import { Hono } from "hono"
import { createShareLinkBody, memberChangeBody, type MemberDto, type ShareLinkDto } from "@shared/api"
import { requireAdmin, scopeIdOf, toAssignment } from "../access"
import { normaliseEmail } from "../auth/otp"
import { randomToken } from "../auth/crypto"
import type { ProgrammeEnv } from "../context"
import type { Db } from "../db/client"
import { courses, programmeRoles, shareLinks, trajectories, users } from "../db/schema"
import { invalid, notFound } from "../errors"
import { validate } from "../validation"
import { findOrCreateUser } from "./auth"
import { notify } from "./notify"

export const memberRoutes = new Hono<ProgrammeEnv>()

memberRoutes.get("/members", async (c) => {
  requireAdmin(c)
  const rows = await c
    .get("db")
    .select({
      userId: users.id,
      email: users.email,
      role: programmeRoles.role,
      scopeId: programmeRoles.scopeId,
    })
    .from(programmeRoles)
    .innerJoin(users, eq(users.id, programmeRoles.userId))
    .where(eq(programmeRoles.programmeId, c.get("programmeId")))
    .orderBy(users.email)
  const members = new Map<string, MemberDto>()
  for (const row of rows) {
    const member = members.get(row.userId) ?? { userId: row.userId, email: row.email, assignments: [] }
    member.assignments.push(toAssignment(row))
    members.set(row.userId, member)
  }
  return c.json([...members.values()])
})

memberRoutes.post("/members", validate("json", memberChangeBody), async (c) => {
  requireAdmin(c)
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  const { email, assignment } = c.req.valid("json")
  await assertScopeExists(db, programmeId, assignment)
  const userId = await findOrCreateUser(db, normaliseEmail(email))
  await db
    .insert(programmeRoles)
    .values({ programmeId, userId, role: assignment.role, scopeId: scopeIdOf(assignment) })
    .onConflictDoNothing()
  notify(c, "members")
  return c.json({ ok: true })
})

memberRoutes.post("/members/remove", validate("json", memberChangeBody), async (c) => {
  requireAdmin(c)
  const db = c.get("db")
  const programmeId = c.get("programmeId")
  const { email, assignment } = c.req.valid("json")
  const user = await db.select({ id: users.id }).from(users).where(eq(users.email, normaliseEmail(email))).get()
  if (!user) throw notFound("No such member")
  if (assignment.role === "admin" && user.id === c.get("user")?.id) {
    throw invalid("You cannot remove your own admin role")
  }
  await db
    .delete(programmeRoles)
    .where(
      and(
        eq(programmeRoles.programmeId, programmeId),
        eq(programmeRoles.userId, user.id),
        eq(programmeRoles.role, assignment.role),
        eq(programmeRoles.scopeId, scopeIdOf(assignment)),
      ),
    )
  notify(c, "members")
  return c.json({ ok: true })
})

async function assertScopeExists(
  db: Db,
  programmeId: string,
  assignment: MemberDto["assignments"][number],
): Promise<void> {
  if (assignment.role === "trajectory_coordinator") {
    const row = await db
      .select({ id: trajectories.id })
      .from(trajectories)
      .where(and(eq(trajectories.id, assignment.trajectoryId), eq(trajectories.programmeId, programmeId)))
      .get()
    if (!row) throw notFound("Trajectory not found")
  }
  if (assignment.role === "course_coordinator") {
    const row = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.id, assignment.courseId), eq(courses.programmeId, programmeId)))
      .get()
    if (!row) throw notFound("Course not found")
  }
}

// ── Share links ─────────────────────────────────────────────────────────────

memberRoutes.get("/share-links", async (c) => {
  requireAdmin(c)
  const rows = await c
    .get("db")
    .select()
    .from(shareLinks)
    .where(eq(shareLinks.programmeId, c.get("programmeId")))
    .orderBy(shareLinks.createdAt)
  const result: ShareLinkDto[] = rows.map((r) => ({
    token: r.token,
    label: r.label,
    createdAt: r.createdAt,
  }))
  return c.json(result)
})

memberRoutes.post("/share-links", validate("json", createShareLinkBody), async (c) => {
  requireAdmin(c)
  const token = randomToken(18)
  await c.get("db").insert(shareLinks).values({
    token,
    programmeId: c.get("programmeId"),
    label: c.req.valid("json").label,
    createdBy: c.get("user")?.email ?? null,
  })
  notify(c, "shareLinks")
  return c.json({ token }, 201)
})

memberRoutes.delete("/share-links/:token", async (c) => {
  requireAdmin(c)
  await c
    .get("db")
    .delete(shareLinks)
    .where(and(eq(shareLinks.token, c.req.param("token")), eq(shareLinks.programmeId, c.get("programmeId"))))
  notify(c, "shareLinks")
  return c.json({ ok: true })
})
