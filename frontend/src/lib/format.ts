/** "4, 5, 6" → "P4–6"; non-consecutive periods are listed. */
export function formatPeriods(periods: readonly number[]): string {
  if (periods.length === 0) return "–"
  const sorted = [...periods].sort((a, b) => a - b)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const consecutive = sorted.every((p, i) => i === 0 || p === (sorted[i - 1] ?? p) + 1)
  if (consecutive && first !== undefined && last !== undefined) {
    return first === last ? `P${first}` : `P${first}–${last}`
  }
  return sorted.map((p) => `P${p}`).join(", ")
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}
