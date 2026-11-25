import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { createMiddleware } from "hono/factory"
import { ZodError } from "zod"
import type { ApiErrorBody } from "@shared/api"
import { programmeAccess } from "./access"
import { readSession, rememberShareToken } from "./auth/session"
import type { AppEnv, ProgrammeEnv } from "./context"
import { createDb } from "./db/client"
import { shareLinks } from "./db/schema"
import { HttpError } from "./errors"
import { authRoutes } from "./routes/auth"
import { courseRoutes } from "./routes/courses"
import { feedbackRoutes } from "./routes/feedback"
import { frameworkRoutes } from "./routes/frameworks"
import { mediaRoutes } from "./routes/media"
import { memberRoutes } from "./routes/members"
import { programmeListRoutes, programmeRoutes } from "./routes/programmes"
import { structureRoutes } from "./routes/structure"
import { viewRoutes } from "./routes/views"

export const app = new Hono<AppEnv>()

/** Database handle and the logged-in user (if any) for every request. */
const session = createMiddleware<AppEnv>(async (c, next) => {
  const db = createDb(c.env.DB)
  c.set("db", db)
  c.set("user", await readSession(c, db))
  await next()
})

app.use("*", session)

app.onError((error, c) => {
  if (error instanceof HttpError) return c.json(error.toBody(), error.status)
  if (error instanceof ZodError) {
    return c.json<ApiErrorBody>(
      { error: error.issues[0]?.message ?? "Invalid request", code: "invalid" },
      400,
    )
  }
  console.error("[worker] Unhandled error", error)
  return c.json<ApiErrorBody>({ error: "Something went wrong on the server" }, 500)
})

app.route("/api/auth", authRoutes)
app.route("/api/programmes", programmeListRoutes)

const programme = new Hono<ProgrammeEnv>()
programme.use("*", programmeAccess)
programme.route("/", programmeRoutes)
programme.route("/", memberRoutes)
programme.route("/", structureRoutes)
programme.route("/", frameworkRoutes)
programme.route("/", courseRoutes)
programme.route("/", feedbackRoutes)
programme.route("/", viewRoutes)
programme.route("/", mediaRoutes)
app.route("/api/p/:pid", programme)

app.all("/api/*", (c) => c.json<ApiErrorBody>({ error: "Not found", code: "not_found" }, 404))

/** Share links: remember the token in a cookie and open the programme read-only. */
app.get("/s/:token", async (c) => {
  const token = c.req.param("token")
  const link = await c
    .get("db")
    .select({ programmeId: shareLinks.programmeId })
    .from(shareLinks)
    .where(eq(shareLinks.token, token))
    .get()
  if (!link) return c.redirect("/?share=invalid")
  rememberShareToken(c, token)
  return c.redirect(`/p/${link.programmeId}`)
})
