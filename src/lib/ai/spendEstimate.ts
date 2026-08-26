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
let sessionTranscriptionBytes = 0

/** Record an outbound payload's size in characters. Ignores junk input. */
export function addEstimate(chars: number): void {
  if (!Number.isFinite(chars) || chars <= 0) return
  sessionChars += chars
}

/** Approximate tokens sent this session (chars / 4, rounded). */
export function getSessionEstimate(): number {
  return Math.round(sessionChars / CHARS_PER_TOKEN)
}

/**
 * Record an outbound transcription payload's size in bytes. Tracked
 * separately from the char-based token estimate above — audio bytes and
 * text chars are not the same unit, and Whisper's actual billing unit
 * (audio minutes) isn't cheaply derivable client-side without decoding the
 * blob, so bytes-sent is used as an honest, labeled proxy. Ignores junk
 * input.
 */
export function addTranscriptionEstimate(bytes: number): void {
  if (!Number.isFinite(bytes) || bytes <= 0) return
  sessionTranscriptionBytes += bytes
}

/** Total audio bytes sent for transcription this session. */
export function getTranscriptionEstimate(): number {
  return sessionTranscriptionBytes
}

/** Test hygiene / explicit reset. */
export function resetSessionEstimate(): void {
  sessionChars = 0
  sessionTranscriptionBytes = 0
}
