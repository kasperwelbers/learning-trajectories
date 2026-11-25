import { useQuery } from "@tanstack/react-query"
import { X } from "lucide-react"
import { useState, type SyntheticEvent } from "react"
import { ROLE_LABELS, ROLES, type Role, type RoleAssignment } from "@shared/roles"
import { keys } from "@/api/keys"
import { queries, useApiMutation } from "@/api/queries"
import { Loading, QueryError } from "@/components/layout/ErrorView"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useProgramme } from "@/hooks/useProgramme"
import { SettingsSection } from "./SettingsPage"

export function MembersSettings() {
  const { programme, year } = useProgramme()
  const members = useQuery(queries.members(programme.id))
  const structure = useQuery(queries.structure(programme.id))
  const courses = useQuery(queries.courses(programme.id, year))

  const trajectoryName = (id: number) =>
    structure.data?.trajectories.find((t) => t.id === id)?.name ?? `trajectory ${id}`
  const courseName = (id: number) => {
    const c = courses.data?.courses.find((x) => x.id === id)
    return c ? `${c.code} ${c.name}` : `course ${id}`
  }
  const describe = (a: RoleAssignment) =>
    a.role === "admin"
      ? ROLE_LABELS.admin
      : a.role === "trajectory_coordinator"
        ? `Coordinator of ${trajectoryName(a.trajectoryId)}`
        : `Coordinator of ${courseName(a.courseId)}`

  const remove = useApiMutation<{ email: string; assignment: RoleAssignment }>({
    request: (body) => ({
      method: "POST",
      path: `/api/p/${programme.id}/members/remove`,
      body,
    }),
    invalidate: () => [keys.members(programme.id)],
  })

  return (
    <SettingsSection
      title="Members & roles"
      description="People log in with their e-mail address. Programme admins can change everything; trajectory coordinators edit their trajectory; course coordinators manage their course's documents and feedback."
    >
      <AddMember />
      {members.error && <QueryError error={members.error} />}
      {!members.data && !members.error && <Loading />}
      <ul className="divide-y rounded-xl border bg-card">
        {members.data?.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-start gap-3 px-4 py-3">
            <span className="w-64 truncate font-medium">{m.email}</span>
            <span className="flex flex-1 flex-wrap gap-1.5">
              {m.assignments.map((a, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pr-1 pl-2.5 text-xs"
                >
                  {describe(a)}
                  <button
                    type="button"
                    className="rounded-full p-0.5 hover:bg-background"
                    aria-label={`Remove ${describe(a)}`}
                    onClick={() => remove.mutate({ email: m.email, assignment: a })}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </SettingsSection>
  )
}

function AddMember() {
  const { programme, year } = useProgramme()
  const structure = useQuery(queries.structure(programme.id))
  const courses = useQuery(queries.courses(programme.id, year))
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<Role>("course_coordinator")
  const [scope, setScope] = useState("")
  const add = useApiMutation<{ email: string; assignment: RoleAssignment }>({
    request: (body) => ({
      method: "POST",
      path: `/api/p/${programme.id}/members`,
      body,
    }),
    invalidate: () => [keys.members(programme.id)],
    success: "Member added",
  })

  const submit = (event: SyntheticEvent) => {
    event.preventDefault()
    const id = Number(scope)
    const assignment: RoleAssignment | null =
      role === "admin"
        ? { role }
        : role === "trajectory_coordinator"
          ? id
            ? { role, trajectoryId: id }
            : null
          : id
            ? { role, courseId: id }
            : null
    if (!assignment) return
    add.mutate({ email, assignment }, { onSuccess: () => setEmail("") })
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3"
    >
      <Input
        type="email"
        required
        placeholder="name@university.nl"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-64"
      />
      <Select
        value={role}
        onValueChange={(v) => {
          setRole(ROLES.find((r) => r === v) ?? "course_coordinator")
          setScope("")
        }}
      >
        <SelectTrigger className="w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ROLES.map((r) => (
            <SelectItem key={r} value={r}>
              {ROLE_LABELS[r]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {role !== "admin" && (
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger className="w-64">
            <SelectValue
              placeholder={
                role === "trajectory_coordinator" ? "Which trajectory?" : "Which course?"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {role === "trajectory_coordinator"
              ? structure.data?.trajectories.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name}
                  </SelectItem>
                ))
              : courses.data?.courses.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.code} {c.name}
                  </SelectItem>
                ))}
          </SelectContent>
        </Select>
      )}
      <Button type="submit" disabled={add.isPending || (role !== "admin" && !scope)}>
        Add
      </Button>
    </form>
  )
}
