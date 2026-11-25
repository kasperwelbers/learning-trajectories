import { queryOptions, useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query"
import { toast } from "sonner"
import type {
  CourseDetailResponse,
  CoursesResponse,
  CoverageResponse,
  FieldDto,
  FrameworkDto,
  JustificationDto,
  LtoEvidenceResponse,
  MeResponse,
  MemberDto,
  MetadataTableResponse,
  ProgrammeDto,
  ProgrammeSummaryDto,
  ShareLinkDto,
  StructureResponse,
} from "@shared/api"
import { apiGet, apiSend, errorMessage } from "./client"
import { keys } from "./keys"

/** Query definitions, one per resource. Components use them with useQuery/useSuspenseQuery. */
export const queries = {
  me: () =>
    queryOptions({
      queryKey: keys.me,
      queryFn: () => apiGet<MeResponse>("/api/auth/me"),
    }),
  programmes: () =>
    queryOptions({
      queryKey: keys.programmes,
      queryFn: () => apiGet<ProgrammeSummaryDto[]>("/api/programmes"),
    }),
  programme: (pid: string) =>
    queryOptions({
      queryKey: keys.programme(pid),
      queryFn: () => apiGet<ProgrammeDto>(`/api/p/${pid}`),
    }),
  members: (pid: string) =>
    queryOptions({
      queryKey: keys.members(pid),
      queryFn: () => apiGet<MemberDto[]>(`/api/p/${pid}/members`),
    }),
  shareLinks: (pid: string) =>
    queryOptions({
      queryKey: keys.shareLinks(pid),
      queryFn: () => apiGet<ShareLinkDto[]>(`/api/p/${pid}/share-links`),
    }),
  structure: (pid: string) =>
    queryOptions({
      queryKey: keys.structure(pid),
      queryFn: () => apiGet<StructureResponse>(`/api/p/${pid}/structure`),
    }),
  frameworks: (pid: string) =>
    queryOptions({
      queryKey: keys.frameworks(pid),
      queryFn: () => apiGet<FrameworkDto[]>(`/api/p/${pid}/frameworks`),
    }),
  justifications: (pid: string) =>
    queryOptions({
      queryKey: keys.justifications(pid),
      queryFn: () => apiGet<JustificationDto[]>(`/api/p/${pid}/justifications`),
    }),
  fields: (pid: string) =>
    queryOptions({
      queryKey: keys.fields(pid),
      queryFn: () => apiGet<FieldDto[]>(`/api/p/${pid}/fields`),
    }),
  courses: (pid: string, year: string) =>
    queryOptions({
      queryKey: keys.courses(pid, year),
      queryFn: () => apiGet<CoursesResponse>(`/api/p/${pid}/courses?year=${year}`),
    }),
  course: (pid: string, courseId: number, year: string) =>
    queryOptions({
      queryKey: keys.course(pid, courseId, year),
      queryFn: () => apiGet<CourseDetailResponse>(`/api/p/${pid}/courses/${courseId}?year=${year}`),
    }),
  coverage: (pid: string, year: string) =>
    queryOptions({
      queryKey: keys.coverage(pid, year),
      queryFn: () => apiGet<CoverageResponse>(`/api/p/${pid}/coverage?year=${year}`),
    }),
  evidence: (pid: string, ltoId: number, year: string) =>
    queryOptions({
      queryKey: keys.evidence(pid, ltoId, year),
      queryFn: () =>
        apiGet<LtoEvidenceResponse>(`/api/p/${pid}/ltos/${ltoId}/evidence?year=${year}`),
    }),
  metadata: (pid: string, year: string) =>
    queryOptions({
      queryKey: keys.metadata(pid, year),
      queryFn: () => apiGet<MetadataTableResponse>(`/api/p/${pid}/metadata?year=${year}`),
    }),
}

type Method = "POST" | "PATCH" | "PUT" | "DELETE"

interface ApiMutationOptions<TVars, TResult> {
  /** Request for the given variables. */
  request: (vars: TVars) => { method: Method; path: string; body?: unknown }
  /** Keys to invalidate on success (the realtime socket also does this, but this is immediate). */
  invalidate?: (vars: TVars, result: TResult) => QueryKey[]
  /** Toast shown on success. */
  success?: string | ((result: TResult, vars: TVars) => string)
  /** Show errors as toasts (default true). Forms that display errors inline turn this off. */
  toastErrors?: boolean
}

/** A mutation against our API with consistent invalidation and error toasts. */
export function useApiMutation<TVars, TResult = { ok: true }>(
  options: ApiMutationOptions<TVars, TResult>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: TVars) => {
      const { method, path, body } = options.request(vars)
      return apiSend<TResult>(method, path, body)
    },
    onSuccess: async (result, vars) => {
      const success = options.success
      if (success) toast.success(typeof success === "string" ? success : success(result, vars))
      await Promise.all(
        (options.invalidate?.(vars, result) ?? []).map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      )
    },
    onError: (error) => {
      if (options.toastErrors !== false) toast.error(errorMessage(error))
    },
  })
}
