import { extractRawText } from "mammoth"
import { extractText, getDocumentProxy } from "unpdf"

/**
 * Plain text of a document, per page. Used to verify quotes and, for formats the model cannot
 * read natively (DOCX, HTML), as the model's input.
 */
export async function documentPages(bytes: Uint8Array, mimeType: string): Promise<string[]> {
  switch (mimeType) {
    case "application/pdf": {
      const pdf = await getDocumentProxy(bytes.slice())
      const { text } = await extractText(pdf, { mergePages: false })
      return text
    }
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
      const { value } = await extractRawText({
        arrayBuffer: bytes.slice().buffer,
      })
      return [value]
    }
    case "text/html":
      return [htmlToText(new TextDecoder().decode(bytes))]
    default:
      return [new TextDecoder().decode(bytes)]
  }
}

const BLOCK_TAGS = /<\/(p|div|li|tr|h[1-6]|section|article|br)>/gi

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(BLOCK_TAGS, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim()
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X"))
      return String.fromCodePoint(parseInt(entity.slice(2), 16))
    if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(1), 10))
    return ENTITIES[entity.toLowerCase()] ?? match
  })
}
