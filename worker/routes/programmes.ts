import { and, desc, eq, sql } from "drizzle-orm"
import { Hono } from "hono"
import {
  createProgrammeBody,
  updateProgrammeBody,
  type ProgrammeDto,
  type ProgrammeSummaryDto,
} from "@shared/api"
import { sortAcademicYears } from "@shared/academicYear"
import { requireAdmin, toAssignment } from "../access"
import type { AppEnv, ProgrammeEnv } from "../context"
import { assertVersionedUpdate } from "../db/helpers"
import { documents, programmeRoles, programmes } from "../db/schema"
import { forbidden, found, unauthorized } from "../errors"
import { deletePrefix } from "../services/files"
import { seedProgramme } from "../services/seed"
import { validate } from "../validation"
import { notify } from "./notify"

/** /api/programmes — list and create. */
export const programmeListRoutes = new Hono<AppEnv>()

programmeListRoutes.get("/", async (c) => {
  const user = c.get("user")
  if (!user) throw unauthorized()
  const db = c.get("db")
  const rows = user.isServerAdmin
    ? await db.select().from(programmes).orderBy(desc(programmes.createdAt))
    : await db
        .selectDistinct({
          id: programmes.id,
          name: programmes.name,
          currentYear: programmes.currentYear,
          createdAt: programmes.createdAt,
        })
        .from(programmes)
        .innerJoin(programmeRoles, eq(programmeRoles.programmeId, programmes.id))
        .where(eq(programmeRoles.userId, user.id))
        .orderBy(desc(programmes.createdAt))
  const roles = await db.select().from(programmeRoles).where(eq(programmeRoles.userId, user.id))
  const result: ProgrammeSummaryDto[] = rows.map((p) => ({
    id: p.id,
    name: p.name,
    currentYear: p.currentYear,
    roles: roles.filter((r) => r.programmeId === p.id).map(toAssignment),
  }))
  return c.json(result)
})

programmeListRoutes.post("/", validate("json", createProgrammeBody), async (c) => {
  const user = c.get("user")
  if (!user) throw unauthorized()
  if (!user.isServerAdmin) throw forbidden("Only server admins can create programmes")
  const db = c.get("db")
  const { name, currentYear } = c.req.valid("json")
  const id = crypto.randomUUID()
  await db.insert(programmes).values({ id, name, currentYear })
  await db.insert(programmeRoles).values({ programmeId: id, userId: user.id, role: "admin" })
  await seedProgramme(db, id)
  return c.json({ id }, 201)
})

/** /api/p/:pid — a single programme. */
export const programmeRoutes = new Hono<ProgrammeEnv>()

programmeRoutes.get("/", async (c) => {
  const db = c.get("db")
  const id = c.get("programmeId")
  const programme = found(await db.select().from(programmes).where(eq(programmes.id, id)).get())
  const years = await db
    .selectDistinct({ year: documents.year })
    .from(documents)
    .where(eq(documents.programmeId, id))
  const dto: ProgrammeDto = {
    id: programme.id,
    name: programme.name,
    description: programme.description,
    currentYear: programme.currentYear,
    years: sortAcademicYears([programme.currentYear, ...years.map((y) => y.year)]),
    studyGuideUrlTemplate: programme.studyGuideUrlTemplate,
    version: programme.version,
    access: c.get("access"),
  }
  return c.json(dto)
})

programmeRoutes.patch("/", validate("json", updateProgrammeBody), async (c) => {
  requireAdmin(c)
  const db = c.get("db")
  const id = c.get("programmeId")
  const { version, ...changes } = c.req.valid("json")
  const result = await db
    .update(programmes)
    .set({ ...changes, version: sql`${programmes.version} + 1` })
    .where(and(eq(programmes.id, id), eq(programmes.version, version)))
    .run()
  await assertVersionedUpdate(result, () => Promise.resolve(true))
  notify(c, "programme", "courses", "coverage")
  return c.json({ ok: true })
})

programmeRoutes.delete("/", async (c) => {
  const user = c.get("user")
  if (!user?.isServerAdmin) throw forbidden("Only server admins can delete programmes")
  const id = c.get("programmeId")
  await c.get("db").delete(programmes).where(eq(programmes.id, id))
  await deletePrefix(c.env.FILES, `p/${id}/`)
  return c.json({ ok: true })
})
