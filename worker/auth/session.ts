import { and, eq, gt, lt } from "drizzle-orm"
import type { Context, Env as HonoEnv } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import type { Db } from "../db/client"
import { sessions, users } from "../db/schema"
import type { SessionUser } from "../context"
import { randomToken, sha256Hex } from "./crypto"

const SESSION_COOKIE = "lt_session"
const SESSION_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

function cookieOptions<E extends HonoEnv>(c: Context<E>) {
  return {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax" as const,
    path: "/",
  }
}

export async function createSession<E extends HonoEnv>(
  c: Context<E>,
  db: Db,
  userId: string,
): Promise<void> {
  const token = randomToken()
  await db.insert(sessions).values({
    tokenHash: await sha256Hex(token),
    userId,
    expiresAt: Date.now() + SESSION_DAYS * DAY_MS,
  })
  setCookie(c, SESSION_COOKIE, token, {
    ...cookieOptions(c),
    maxAge: SESSION_DAYS * 86400,
  })
}

export async function readSession<E extends HonoEnv>(
  c: Context<E>,
  db: Db,
): Promise<SessionUser | null> {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return null
  const tokenHash = await sha256Hex(token)
  const row = await db
    .select({
      id: users.id,
      email: users.email,
      isServerAdmin: users.isServerAdmin,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, Date.now())))
    .get()
  return row ?? null
}

export async function destroySession<E extends HonoEnv>(c: Context<E>, db: Db): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, await sha256Hex(token)))
  }
  deleteCookie(c, SESSION_COOKIE, cookieOptions(c))
  // Opportunistic cleanup of expired sessions
  await db.delete(sessions).where(lt(sessions.expiresAt, Date.now()))
}

// ── Share links ─────────────────────────────────────────────────────────────

const SHARE_COOKIE = "lt_share"

/** Share tokens a visitor has opened, as a comma-separated cookie. */
export function readShareTokens<E extends HonoEnv>(c: Context<E>): string[] {
  const raw = getCookie(c, SHARE_COOKIE)
  return raw ? raw.split(",").filter((t) => /^[A-Za-z0-9_-]{16,64}$/.test(t)) : []
}

export function rememberShareToken<E extends HonoEnv>(c: Context<E>, token: string): void {
  const tokens = [token, ...readShareTokens(c).filter((t) => t !== token)].slice(0, 10)
  setCookie(c, SHARE_COOKIE, tokens.join(","), {
    ...cookieOptions(c),
    maxAge: 365 * 86400,
  })
}
