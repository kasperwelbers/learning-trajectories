import type { QuoteVerification } from "@shared/evidence"

/**
 * Checks that a quote really occurs in a document. PDF text layers are messy (hidden
 * characters, words split by layout, hyphenation), so comparison happens on letters and
 * digits only: exact containment means "verified"; a high share of shared character
 * trigrams means "approximate".
 */

const TRIGRAM_THRESHOLD = 0.8
/** Shorter quotes match too easily to mean anything. */
const MIN_EXACT_LENGTH = 6
const MIN_APPROXIMATE_LENGTH = 16

export function normaliseForMatch(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // accents
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
}

function trigrams(text: string): Set<string> {
  const set = new Set<string>()
  for (let i = 0; i + 3 <= text.length; i++) set.add(text.slice(i, i + 3))
  return set
}

export class DocumentMatcher {
  private readonly pages: string[]
  private readonly whole: string
  private readonly wholeTrigrams: Set<string>

  constructor(pages: readonly string[]) {
    this.pages = pages.map(normaliseForMatch)
    this.whole = this.pages.join("")
    this.wholeTrigrams = trigrams(this.whole)
  }

  get isEmpty(): boolean {
    return this.whole.length === 0
  }

  verify(quote: string): QuoteVerification {
    const needle = normaliseForMatch(quote)
    if (needle.length < MIN_EXACT_LENGTH || this.isEmpty) return "unverified"
    if (this.whole.includes(needle)) return "verified"
    if (needle.length < MIN_APPROXIMATE_LENGTH) return "unverified"
    const quoteTrigrams = trigrams(needle)
    let shared = 0
    for (const t of quoteTrigrams) if (this.wholeTrigrams.has(t)) shared++
    return shared / quoteTrigrams.size >= TRIGRAM_THRESHOLD ? "approximate" : "unverified"
  }

  /** 1-based page on which the quote occurs, if it can be found exactly. */
  pageOf(quote: string): number | null {
    const needle = normaliseForMatch(quote)
    if (needle.length < MIN_EXACT_LENGTH) return null
    const index = this.pages.findIndex((p) => p.includes(needle))
    return index >= 0 ? index + 1 : null
  }
}
