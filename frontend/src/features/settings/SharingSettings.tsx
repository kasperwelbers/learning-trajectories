import { useQuery } from "@tanstack/react-query"
import { Copy, Link2, Trash2 } from "lucide-react"
import { useState, type SyntheticEvent } from "react"
import { toast } from "sonner"
import { keys } from "@/api/keys"
import { queries, useApiMutation } from "@/api/queries"
import { ConfirmButton } from "@/components/layout/ConfirmButton"
import { QueryError } from "@/components/layout/ErrorView"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useProgramme } from "@/hooks/useProgramme"
import { formatDate } from "@/lib/format"
import { SettingsSection } from "./SettingsPage"

export function SharingSettings() {
  const { programme } = useProgramme()
  const links = useQuery(queries.shareLinks(programme.id))
  const [label, setLabel] = useState("")
  const create = useApiMutation<{ label: string }, { token: string }>({
    request: (body) => ({
      method: "POST",
      path: `/api/p/${programme.id}/share-links`,
      body,
    }),
    invalidate: () => [keys.shareLinks(programme.id)],
    success: "Share link created",
  })
  const revoke = useApiMutation<string>({
    request: (token) => ({
      method: "DELETE",
      path: `/api/p/${programme.id}/share-links/${token}`,
    }),
    invalidate: () => [keys.shareLinks(programme.id)],
    success: "Share link revoked",
  })
  const url = (token: string) => `${location.origin}/s/${token}`
  const copy = (token: string) =>
    void navigator.clipboard.writeText(url(token)).then(() => toast.success("Link copied"))

  const submit = (event: SyntheticEvent) => {
    event.preventDefault()
    create.mutate(
      { label },
      {
        onSuccess: ({ token }) => {
          setLabel("")
          copy(token)
        },
      },
    )
  }

  return (
    <SettingsSection
      title="Share links"
      description="Anyone with a share link can view the whole programme (trajectories, courses, evidence and views) without logging in, but cannot change anything. Create separate links per audience so you can revoke them independently."
    >
      <form onSubmit={submit} className="flex max-w-lg gap-2">
        <Input
          placeholder="Label, e.g. Visitation committee 2027"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Button type="submit" disabled={create.isPending}>
          <Link2 /> Create link
        </Button>
      </form>
      {links.error && <QueryError error={links.error} />}
      <ul className="divide-y rounded-xl border bg-card">
        {links.data?.map((link) => (
          <li key={link.token} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{link.label || "Unlabelled link"}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{url(link.token)}</p>
            </div>
            <span className="text-xs text-muted-foreground">{formatDate(link.createdAt)}</span>
            <Button size="xs" variant="outline" onClick={() => copy(link.token)}>
              <Copy /> Copy
            </Button>
            <ConfirmButton
              title="Revoke this link?"
              description="People using it lose access immediately."
              confirmLabel="Revoke"
              onConfirm={() => revoke.mutate(link.token)}
            >
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Revoke"
                className="text-destructive"
              >
                <Trash2 />
              </Button>
            </ConfirmButton>
          </li>
        ))}
        {links.data?.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">
            No share links yet.
          </li>
        )}
      </ul>
    </SettingsSection>
  )
}
