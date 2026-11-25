import { useQuery } from "@tanstack/react-query"
import { Link, Navigate, useNavigate, useSearch } from "@tanstack/react-router"
import { ArrowRight, Plus } from "lucide-react"
import { useState, type SyntheticEvent } from "react"
import { academicYearOf } from "@shared/academicYear"
import { ROLE_LABELS } from "@shared/roles"
import { keys } from "@/api/keys"
import { queries, useApiMutation } from "@/api/queries"
import { Loading, QueryError } from "@/components/layout/ErrorView"
import { UserMenu } from "@/components/layout/UserMenu"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function HomePage() {
  const { share } = useSearch({ from: "/" })
  const me = useQuery(queries.me())
  const user = me.data?.user
  const programmes = useQuery({
    ...queries.programmes(),
    enabled: Boolean(user),
  })

  if (me.isPending) return <Loading />
  if (!user) return <Navigate to="/login" />

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-4xl items-center px-6">
          <span className="font-serif text-lg font-semibold">Learning Trajectories</span>
          <div className="ml-auto">
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-6 px-6 py-12">
        {share === "invalid" && (
          <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            That share link is no longer valid. Ask the programme admin for a new one.
          </p>
        )}
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold">Programmes</h1>
            <p className="mt-1 text-muted-foreground">Programmes you coordinate or administer.</p>
          </div>
          {user.isServerAdmin && <CreateProgrammeDialog />}
        </div>
        {programmes.error && <QueryError error={programmes.error} />}
        {programmes.data?.length === 0 && (
          <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
            You are not a member of any programme yet. A programme admin can add you.
          </p>
        )}
        <ul className="grid gap-3 sm:grid-cols-2">
          {programmes.data?.map((p) => (
            <li key={p.id}>
              <Link
                to="/p/$programmeId"
                params={{ programmeId: p.id }}
                className="group flex h-full flex-col gap-2 rounded-xl border bg-card p-5 transition-shadow hover:shadow-md"
              >
                <span className="flex items-center justify-between font-serif text-xl font-semibold">
                  {p.name}
                  <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </span>
                <span className="text-sm text-muted-foreground">Current year {p.currentYear}</span>
                <span className="text-xs text-muted-foreground">
                  {[...new Set(p.roles.map((r) => ROLE_LABELS[r.role]))].join(" · ") ||
                    "Server admin"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}

function CreateProgrammeDialog() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [year, setYear] = useState(academicYearOf(new Date()))
  const create = useApiMutation<{ name: string; currentYear: string }, { id: string }>({
    request: (body) => ({ method: "POST", path: "/api/programmes", body }),
    invalidate: () => [keys.programmes],
  })
  const submit = (event: SyntheticEvent) => {
    event.preventDefault()
    create.mutate(
      { name, currentYear: year },
      {
        onSuccess: ({ id }) =>
          void navigate({ to: "/p/$programmeId", params: { programmeId: id } }),
      },
    )
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New programme
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New programme</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="programme-name">Name</Label>
            <Input
              id="programme-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="BSc Communication Science"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="programme-year">Current academic year</Label>
            <Input
              id="programme-year"
              required
              pattern="\d{4}-\d{4}"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
