/** Random URL-safe token with `bytes` bytes of entropy. */
export function randomToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  return base64Url(buffer)
}

/** Uniformly random 6-digit code. */
export function randomCode(): string {
  const buffer = new Uint32Array(1)
  // Rejection sampling avoids modulo bias
  const limit = Math.floor(0xffffffff / 1_000_000) * 1_000_000
  do crypto.getRandomValues(buffer)
  while ((buffer[0] ?? limit) >= limit)
  return String((buffer[0] ?? 0) % 1_000_000).padStart(6, "0")
}

export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const source = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data)
  // Copy into a fresh ArrayBuffer-backed view (digest does not accept shared buffers).
  const bytes = new Uint8Array(source.byteLength)
  bytes.set(source)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/** Constant-time string comparison for equal-length secrets. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function base64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
