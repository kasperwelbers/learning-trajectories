import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { requestCodeBody, verifyCodeBody, type MeResponse } from "@shared/api"
import { normaliseEmail, requestLoginCode, verifyLoginCode } from "../auth/otp"
import { createSession, destroySession } from "../auth/session"
import type { AppEnv } from "../context"
import type { Db } from "../db/client"
import { users } from "../db/schema"
import { HttpError } from "../errors"
import { validate } from "../validation"

export const authRoutes = new Hono<AppEnv>()

authRoutes.post("/request-code", validate("json", requestCodeBody), async (c) => {
  await requestLoginCode(c.get("db"), c.env, c.req.valid("json").email)
  return c.json({ ok: true })
})

authRoutes.post("/verify-code", validate("json", verifyCodeBody), async (c) => {
  const { email: rawEmail, code } = c.req.valid("json")
  const db = c.get("db")
  if (!(await verifyLoginCode(db, rawEmail, code))) {
    throw new HttpError(401, "This code is invalid or has expired", "unauthorized")
  }
  const email = normaliseEmail(rawEmail)
  const userId = await findOrCreateUser(db, email)
  if (adminEmails(c.env).has(email)) {
    await db.update(users).set({ isServerAdmin: true }).where(eq(users.id, userId))
  }
  await createSession(c, db, userId)
  return c.json({ ok: true })
})

authRoutes.post("/logout", async (c) => {
  await destroySession(c, c.get("db"))
  return c.json({ ok: true })
})

authRoutes.get("/me", (c) => {
  const user = c.get("user")
  return c.json<MeResponse>({ user })
})

export async function findOrCreateUser(db: Db, email: string): Promise<string> {
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()
  if (existing) return existing.id
  const id = crypto.randomUUID()
  await db.insert(users).values({ id, email }).onConflictDoNothing()
  const row = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()
  return row?.id ?? id
}

function adminEmails(env: Env): Set<string> {
  return new Set(
    env.ADMIN_EMAILS.split(",")
      .map((e) => normaliseEmail(e))
      .filter((e) => e.length > 0),
  )
}
