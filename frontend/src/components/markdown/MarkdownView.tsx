import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

/** Renders a narrative. Raw HTML in markdown is not rendered (react-markdown's default). */
export function MarkdownView({
  markdown,
  className,
  empty,
}: {
  markdown: string
  className?: string
  empty?: string
}) {
  if (!markdown.trim()) {
    return empty ? (
      <p className={cn("text-sm text-muted-foreground italic", className)}>{empty}</p>
    ) : null
  }
  return (
    <div className={cn("prose-narrative", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          img: ({ src, alt }) => (
            <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} loading="lazy" />
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
