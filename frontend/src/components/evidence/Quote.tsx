import type { DocumentKind, QuoteVerification, StatementKind } from "@shared/evidence"
import { SourceBadge, StatementKindBadge, VerificationIcon } from "./Badges"

interface QuoteProps {
  programmeId: string
  quote: string
  context?: string
  kind?: StatementKind
  page: number | null
  verification: QuoteVerification
  document?: { id: number; kind: DocumentKind; filename: string }
  assessedBy?: string[]
}

/** A verbatim quote from a course document, with where it comes from. */
export function Quote({ programmeId, quote, context, kind, page, verification, document, assessedBy }: QuoteProps) {
  const href = document ? `/api/p/${programmeId}/documents/${document.id}/file${page ? `#page=${page}` : ""}` : undefined
  return (
    <figure className="space-y-1.5">
      <blockquote className="border-l-2 border-border pl-3 text-sm leading-relaxed">
        {context && <span className="text-muted-foreground">{context} … </span>}
        <span>“{quote}”</span>
      </blockquote>
      <figcaption className="flex flex-wrap items-center gap-1.5 pl-3 text-xs text-muted-foreground">
        <VerificationIcon verification={verification} />
        {kind && <StatementKindBadge kind={kind} />}
        {document && <SourceBadge kind={document.kind} />}
        {href && (
          <a href={href} target="_blank" rel="noreferrer" className="hover:underline">
            {document?.filename}
            {page ? `, p. ${page}` : ""}
          </a>
        )}
        {assessedBy && assessedBy.length > 0 && <span>· assessed by {assessedBy.join(", ")}</span>}
      </figcaption>
    </figure>
  )
}
