import { BLOOM, BLOOM_DOMAINS, levelsOf, type BloomDomain } from "@shared/bloom"
import { coveredDomains, type CoverageState, type FlowerCoverage } from "@shared/coverage"
import { cn } from "@/lib/utils"
import { DOMAIN_COLOR, EMPTY_COLOR } from "./colors"

/**
 * A flower per Bloom domain: one petal per level, clockwise from the top (low → high).
 * Filled petal = tested, outlined petal = taught only, grey = not covered.
 */

export const STATE_LABEL: Record<CoverageState | "none", string> = {
  tested: "taught and tested",
  taught: "taught, not tested",
  none: "not covered",
}

interface FlowerProps {
  domain: BloomDomain
  coverage: FlowerCoverage
  size?: number
  /** Extra text per level for the petal tooltip (e.g. course counts). */
  detail?: (level: string) => string | undefined
  className?: string
}

/** Petal path pointing up from the centre (0,0), length 1. */
const PETAL = "M0 0 C -0.32 -0.28 -0.3 -0.82 0 -1 C 0.3 -0.82 0.32 -0.28 0 0 Z"

export function Flower({ domain, coverage, size = 28, detail, className }: FlowerProps) {
  const levels: readonly string[] = levelsOf(domain)
  const states: Partial<Record<string, CoverageState>> = coverage[domain]
  const info = BLOOM[domain]
  const color = DOMAIN_COLOR[domain]
  const step = 360 / levels.length
  const summary = levels
    .map((level, i) => `${info.levels[i]?.label ?? level}: ${STATE_LABEL[states[level] ?? "none"]}`)
    .join("; ")

  return (
    <svg
      viewBox="-1.15 -1.15 2.3 2.3"
      width={size}
      height={size}
      role="img"
      aria-label={`${info.label} domain — ${summary}`}
      className={cn("shrink-0 overflow-visible", className)}
    >
      {levels.map((level, i) => {
        const state = states[level]
        const label = info.levels[i]?.label ?? level
        const extra = detail?.(level)
        return (
          <path
            key={level}
            d={PETAL}
            transform={`rotate(${i * step})`}
            fill={
              state === "tested"
                ? color
                : state === "taught"
                  ? `color-mix(in oklab, ${color} 22%, transparent)`
                  : EMPTY_COLOR
            }
            stroke={state ? color : "var(--background)"}
            strokeWidth={state === "taught" ? 0.09 : 0.05}
            strokeLinejoin="round"
          >
            <title>{`${info.label} · ${label}: ${STATE_LABEL[state ?? "none"]}${extra ? ` — ${extra}` : ""}`}</title>
          </path>
        )
      })}
      <circle r={0.16} fill="var(--background)" stroke={color} strokeWidth={0.06} />
    </svg>
  )
}

interface FlowerRowProps {
  coverage: FlowerCoverage | undefined
  size?: number
  /** Show a flower for every domain, even without coverage. */
  all?: boolean
  labels?: boolean
  detail?: (domain: BloomDomain, level: string) => string | undefined
  className?: string
}

/** The flowers of an LTO: by default only for domains with at least one covered level. */
export function FlowerRow({
  coverage,
  size = 28,
  all = false,
  labels = false,
  detail,
  className,
}: FlowerRowProps) {
  const domains = coverage ? (all ? [...BLOOM_DOMAINS] : coveredDomains(coverage)) : []
  if (!coverage || domains.length === 0) {
    return <span className={cn("text-xs text-muted-foreground", className)}>No evidence yet</span>
  }
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {domains.map((domain) => (
        <span key={domain} className="inline-flex flex-col items-center gap-1">
          <Flower
            domain={domain}
            coverage={coverage}
            size={size}
            detail={detail ? (level) => detail(domain, level) : undefined}
          />
          {labels && (
            <span className="text-[0.7rem] text-muted-foreground">{BLOOM[domain].label}</span>
          )}
        </span>
      ))}
    </span>
  )
}

/** Legend explaining petals and states. */
export function FlowerLegend({ className }: { className?: string }) {
  const demo: FlowerCoverage = {
    cognitive: {
      remember: "tested",
      understand: "tested",
      apply: "taught",
      analyse: "taught",
    },
    affective: {},
    psychomotor: {},
  }
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <span className="inline-flex items-center gap-2">
        <Flower domain="cognitive" coverage={demo} size={26} />
        Petals are Bloom levels, clockwise from the top (low → high)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-3 rounded-full" style={{ background: DOMAIN_COLOR.cognitive }} />{" "}
        tested
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="size-3 rounded-full border-2"
          style={{
            borderColor: DOMAIN_COLOR.cognitive,
            background: `color-mix(in oklab, ${DOMAIN_COLOR.cognitive} 22%, transparent)`,
          }}
        />{" "}
        taught only
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-3 rounded-full" style={{ background: EMPTY_COLOR }} /> not covered
      </span>
      {BLOOM_DOMAINS.map((d) => (
        <span key={d} className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-sm" style={{ background: DOMAIN_COLOR[d] }} />{" "}
          {BLOOM[d].label}
        </span>
      ))}
    </div>
  )
}
