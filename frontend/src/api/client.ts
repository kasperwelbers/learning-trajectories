import type { ApiErrorBody } from "@shared/api"

/** An error response from our API, with the server's message. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: ApiErrorBody["code"],
  ) {
    super(message)
  }

  get isConflict(): boolean {
    return this.status === 409
  }
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  )
}

async function handle<T>(response: Response): Promise<T> {
  const text = await response.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }
  if (!response.ok) {
    const message = isErrorBody(body) ? body.error : `Request failed (${response.status})`
    throw new ApiError(message, response.status, isErrorBody(body) ? body.code : undefined)
  }
  // The server is the source of these types (see shared/api.ts).
  return body as T
}

export async function apiGet<T>(path: string): Promise<T> {
  return handle<T>(await fetch(path, { credentials: "same-origin" }))
}

export async function apiSend<T>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  })
  return handle<T>(response)
}

export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  return handle<T>(
    await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      body: form,
    }),
  )
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return "Something went wrong"
}
