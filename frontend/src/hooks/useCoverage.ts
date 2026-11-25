import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import type { CourseFactsDto } from "@shared/api"
import { flowersByLto, type CoverageLink, type FlowerCoverage } from "@shared/coverage"
import { queries } from "@/api/queries"
import { useProgramme } from "./useProgramme"

export interface CoverageData {
  links: CoverageLink[]
  courses: CourseFactsDto[]
  courseById: Map<number, CourseFactsDto>
  flowers: Map<number, FlowerCoverage>
  disputed: Set<string>
}

/** Coverage of the selected year with derived lookups, shared by flowers, heatmap and matrix. */
export function useCoverage() {
  const { programme, year } = useProgramme()
  const query = useQuery(queries.coverage(programme.id, year))
  const data = useMemo<CoverageData | undefined>(() => {
    if (!query.data) return undefined
    return {
      links: query.data.links,
      courses: query.data.courses,
      courseById: new Map(query.data.courses.map((c) => [c.id, c])),
      flowers: flowersByLto(query.data.links),
      disputed: new Set(query.data.disputedPairs),
    }
  }, [query.data])
  return { ...query, data }
}
