import { eq, sql } from "drizzle-orm"
import type { Db } from "../db/client"
import { otpCodes } from "../db/schema"
import { HttpError } from "../errors"
import { randomCode, sha256Hex, timingSafeEqual } from "./crypto"
import { sendLoginCode } from "./email"

const CODE_TTL_MS = 10 * 60 * 1000
/** A new code can be requested once this much of the old code's lifetime has passed. */
const RESEND_AFTER_MS = 60 * 1000
const MAX_ATTEMPTS = 5

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

export async function requestLoginCode(db: Db, env: Env, rawEmail: string): Promise<void> {
  const email = normaliseEmail(rawEmail)
  const existing = await db.select().from(otpCodes).where(eq(otpCodes.email, email)).get()
  if (existing && existing.expiresAt - CODE_TTL_MS + RESEND_AFTER_MS > Date.now()) {
    throw new HttpError(429, "A code was just sent. Check your e-mail or try again in a minute.")
  }
  const code = randomCode()
  const values = {
    email,
    codeHash: await sha256Hex(`${email}:${code}`),
    expiresAt: Date.now() + CODE_TTL_MS,
    attempts: 0,
  }
  await db
    .insert(otpCodes)
    .values(values)
    .onConflictDoUpdate({ target: otpCodes.email, set: values })
  await sendLoginCode(env, email, code)
}

/** Returns true and consumes the code when it is valid. */
export async function verifyLoginCode(db: Db, rawEmail: string, code: string): Promise<boolean> {
  const email = normaliseEmail(rawEmail)
  const row = await db.select().from(otpCodes).where(eq(otpCodes.email, email)).get()
  if (!row) return false
  if (row.expiresAt < Date.now() || row.attempts >= MAX_ATTEMPTS) {
    await db.delete(otpCodes).where(eq(otpCodes.email, email))
    return false
  }
  const hash = await sha256Hex(`${email}:${code}`)
  if (!timingSafeEqual(hash, row.codeHash)) {
    await db
      .update(otpCodes)
      .set({ attempts: sql`${otpCodes.attempts} + 1` })
      .where(eq(otpCodes.email, email))
    return false
  }
  await db.delete(otpCodes).where(eq(otpCodes.email, email))
  return true
}
