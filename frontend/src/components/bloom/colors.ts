import type { BloomDomain } from "@shared/bloom"

/** CSS colour per Bloom domain (defined in index.css for light and dark mode). */
export const DOMAIN_COLOR: Record<BloomDomain, string> = {
  cognitive: "var(--bloom-cognitive)",
  affective: "var(--bloom-affective)",
  psychomotor: "var(--bloom-psychomotor)",
}

export const EMPTY_COLOR = "var(--bloom-empty)"
