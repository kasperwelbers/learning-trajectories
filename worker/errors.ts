import type { ApiErrorBody } from "@shared/api"

type ErrorCode = NonNullable<ApiErrorBody["code"]>

const STATUS: Record<ErrorCode, 400 | 401 | 403 | 404 | 409 | 503> = {
  invalid: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  ai_unavailable: 503,
}

/** An error that maps directly onto an HTTP response. */
export class HttpError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 503
  readonly code: ErrorCode | undefined

  constructor(status: HttpError["status"], message: string, code?: ErrorCode) {
    super(message)
    this.status = status
    this.code = code
  }

  static of(code: ErrorCode, message: string): HttpError {
    return new HttpError(STATUS[code], message, code)
  }

  toBody(): ApiErrorBody {
    return this.code ? { error: this.message, code: this.code } : { error: this.message }
  }
}

export const notFound = (what = "Not found") => HttpError.of("not_found", what)
export const forbidden = (message = "You do not have permission to do this") =>
  HttpError.of("forbidden", message)
export const unauthorized = () => HttpError.of("unauthorized", "Please log in")
export const invalid = (message: string) => HttpError.of("invalid", message)
export const conflict = (
  message = "Someone else changed this in the meantime. Reload and try again.",
) => HttpError.of("conflict", message)

/** Throw a 404 when a lookup came back empty. */
export function found<T>(value: T | undefined | null, what = "Not found"): T {
  if (value === undefined || value === null) throw notFound(what)
  return value
}
