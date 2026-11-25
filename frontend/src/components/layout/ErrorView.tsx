import { Link, type ErrorComponentProps } from "@tanstack/react-router"
import { ApiError } from "@/api/client"
import { Button } from "@/components/ui/button"

export function ErrorView({ error, reset }: ErrorComponentProps) {
  const message = error instanceof ApiError ? error.message : "Something went wrong while showing this page."
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground">{message}</p>
      <div className="flex gap-2">
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
        <Button asChild>
          <Link to="/">Go home</Link>
        </Button>
      </div>
    </div>
  )
}

export function NotFoundView() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">This page does not exist, or you do not have access to it.</p>
      <Button asChild>
        <Link to="/">Go home</Link>
      </Button>
    </div>
  )
}

/** Inline state for a query that failed. */
export function QueryError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : "Could not load this."
  return <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{message}</div>
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="animate-pulse py-12 text-center text-sm text-muted-foreground">{label}</div>
}
