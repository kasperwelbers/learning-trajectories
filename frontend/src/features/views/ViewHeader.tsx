import type { ReactNode } from "react"
import { useProgramme } from "@/hooks/useProgramme"

export function ViewHeader({ title, description, children }: { title: string; description: ReactNode; children?: ReactNode }) {
  const { year } = useProgramme()
  return (
    <header className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">Academic year {year}</p>
        <h1 className="text-3xl font-semibold">{title}</h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">{description}</p>
      </div>
      {children && <div className="no-print flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">{children}</div>}
    </header>
  )
}

/** A labelled checkbox used in the filter row above a view. */
export function FilterToggle({ checked, onChange, children }: { checked: boolean; onChange: (value: boolean) => void; children: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}
