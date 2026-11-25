import { createContext, useContext } from "react"
import type { ProgrammeDto } from "@shared/api"
import type { LiveStatus } from "./useLiveUpdates"

export interface ProgrammeContextValue {
  programme: ProgrammeDto
  /** Selected academic year (search param, or the programme's current year). */
  year: string
  live: { status: LiveStatus; viewers: number }
}

export const ProgrammeContext = createContext<ProgrammeContextValue | null>(null)

/** Programme, selected year and access of the current page. Only valid under /p/$programmeId. */
export function useProgramme(): ProgrammeContextValue {
  const value = useContext(ProgrammeContext)
  if (!value) throw new Error("useProgramme must be used inside a programme page")
  return value
}
