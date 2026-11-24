import { and, eq } from "drizzle-orm"
import { Hono } from "hono"
import type { UploadImageResponse } from "@shared/api"
import { isProgrammeAdmin } from "@shared/roles"
import { requireMember } from "../access"
import type { ProgrammeEnv } from "../context"
import { images } from "../db/schema"
import { forbidden, found, invalid } from "../errors"
import { IMAGE_TYPES, MAX_IMAGE_BYTES, imageKey } from "../services/files"
import { connectToHub } from "../realtime/notify"

export const mediaRoutes = new Hono<ProgrammeEnv>()

/** Images embedded in narratives. Anyone who may edit some narrative may upload. */
mediaRoutes.post("/images", async (c) => {
  requireMember(c)
  const access = c.get("access")
  const mayEditNarratives =
    isProgrammeAdmin(access) ||
    (access.kind === "member" && access.roles.some((r) => r.role === "trajectory_coordinator"))
  if (!mayEditNarratives) throw forbidden("Only programme admins and trajectory coordinators can upload images")
  const form = await c.req.parseBody()
  const file = form.file
  if (!(file instanceof File)) throw invalid("No image uploaded")
  const extension = IMAGE_TYPES[file.type]
  if (!extension) throw invalid("Upload a PNG, JPEG, GIF, WebP or SVG image")
  if (file.size > MAX_IMAGE_BYTES) throw invalid("Images can be at most 5 MB")
  const programmeId = c.get("programmeId")
  const key = imageKey(programmeId, extension)
  await c.env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } })
  await c.get("db").insert(images).values({
    key,
    programmeId,
    mimeType: file.type,
    size: file.size,
    uploadedBy: c.get("user")?.email ?? null,
  })
  const name = key.split("/").pop() ?? key
  return c.json<UploadImageResponse>({ url: `/api/p/${programmeId}/images/${name}` }, 201)
})

mediaRoutes.get("/images/:name", async (c) => {
  const programmeId = c.get("programmeId")
  const key = `p/${programmeId}/images/${c.req.param("name")}`
  const row = found(
    await c.get("db").select().from(images).where(and(eq(images.key, key), eq(images.programmeId, programmeId))).get(),
    "Image not found",
  )
  const object = found(await c.env.FILES.get(key), "Image not found")
  return new Response(object.body, {
    headers: {
      "Content-Type": row.mimeType,
      "Cache-Control": "private, max-age=31536000, immutable",
      // SVGs may contain scripts; never let them run in our origin.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  })
})

/** WebSocket for real-time invalidation (access was checked by the programme middleware). */
mediaRoutes.get("/live", (c) => {
  if (c.req.header("Upgrade") !== "websocket") throw invalid("Expected a WebSocket upgrade")
  return connectToHub(c.env, c.get("programmeId"), c.req.raw)
})
