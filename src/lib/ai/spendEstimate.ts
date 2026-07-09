/**
 * Soft, session-scoped spend indicator. Every outbound AI payload reports its
 * character count here (fetchStructured, fetchEmbeddings); the settings panel
 * shows the running total as an approximate token count (chars / 4 — the
 * common rough heuristic for English text). Display only: nothing is
 * enforced, nothing is persisted, and the number is clearly labeled an
 * estimate. Resets with the page session.
 */

const CHARS_PER_TOKEN = 4

let sessionChars = 0

/** Record an outbound payload's size in characters. Ignores junk input. */
export function addEstimate(chars: number): void {
  if (!Number.isFinite(chars) || chars <= 0) return
  sessionChars += chars
}

/** Approximate tokens sent this session (chars / 4, rounded). */
export function getSessionEstimate(): number {
  return Math.round(sessionChars / CHARS_PER_TOKEN)
}

/** Test hygiene / explicit reset. */
export function resetSessionEstimate(): void {
  sessionChars = 0
}
