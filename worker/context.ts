import type { Context } from "hono"
import type { ProgrammeAccess } from "@shared/roles"
import type { Db } from "./db/client"

export interface SessionUser {
  id: string
  email: string
  isServerAdmin: boolean
}

export interface AppEnv {
  Bindings: Env
  Variables: {
    db: Db
    user: SessionUser | null
  }
}

/** Routes under /api/p/:pid; set by the programme access middleware. */
export interface ProgrammeEnv {
  Bindings: Env
  Variables: AppEnv["Variables"] & {
    programmeId: string
    access: ProgrammeAccess
  }
}

export type AppContext = Context<AppEnv>
export type ProgrammeContext = Context<ProgrammeEnv>
