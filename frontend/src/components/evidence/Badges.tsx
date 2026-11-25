import { BookOpenText, CircleCheck, FileText, Globe, Paperclip, TriangleAlert } from "lucide-react"
import { BLOOM, levelInfo, type BloomRef } from "@shared/bloom"
import { DOCUMENT_KIND_LABELS, STATEMENT_KIND_LABELS, type DocumentKind, type QuoteVerification, type StatementKind } from "@shared/evidence"
import { cn } from "@/lib/utils"
import { DOMAIN_COLOR } from "@/components/bloom/colors"

const pill = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem] font-medium whitespace-nowrap"

export function LevelBadge({ refValue, tested }: { refValue: BloomRef; tested?: boolean }) {
  const color = DOMAIN_COLOR[refValue.domain]
  return (
    <span
      className={cn(pill, "border")}
      style={{
        borderColor: color,
        background: tested ? color : `color-mix(in oklch, ${color} 14%, transparent)`,
        color: tested ? "white" : "var(--foreground)",
      }}
      title={`${BLOOM[refValue.domain].label} domain${tested === undefined ? "" : tested ? " · tested" : " · taught, not tested"}`}
    >
      {levelInfo(refValue).label}
    </span>
  )
}

const SOURCE_ICON: Record<DocumentKind, typeof Globe> = {
  study_guide: Globe,
  manual: BookOpenText,
  supplementary: Paperclip,
}

export function SourceBadge({ kind }: { kind: DocumentKind }) {
  const Icon = SOURCE_ICON[kind]
  return (
    <span className={cn(pill, "bg-muted text-muted-foreground")}>
      <Icon className="size-3" /> {DOCUMENT_KIND_LABELS[kind]}
    </span>
  )
}

export function StatementKindBadge({ kind }: { kind: StatementKind }) {
  return <span className={cn(pill, kind === "assessment" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground")}>{STATEMENT_KIND_LABELS[kind]}</span>
}

export function VerificationIcon({ verification }: { verification: QuoteVerification }) {
  if (verification === "verified") {
    return (
      <span title="Quote found verbatim in the document">
        <CircleCheck className="size-3.5 text-success" />
      </span>
    )
  }
  if (verification === "approximate") {
    return (
      <span title="Quote found approximately in the document">
        <CircleCheck className="size-3.5 text-warning" />
      </span>
    )
  }
  return (
    <span title="Quote could not be found in the document text">
      <TriangleAlert className="size-3.5 text-destructive" />
    </span>
  )
}

export function DocIcon() {
  return <FileText className="size-3.5" />
}
