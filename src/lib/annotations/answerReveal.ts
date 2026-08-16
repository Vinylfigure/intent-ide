import type { Node as PMNode } from 'prosemirror-model'

/**
 * Flow-state buffering for ANSWER reveals (Flow v1): when an ask/dig
 * resolution finishes while the user is reading elsewhere, the answer's
 * presentation is held until a natural reading breakpoint instead of
 * flipping the card to "Ready" mid-paragraph. Pure functions here; the
 * hold state itself lives in flowStore and the poll in AnnotationCard.
 *
 * Mirrors cascadeReveal.ts (`cascadeBreakpointPos`) coordinate conventions:
 * the breakpoint is the content END of the anchor's block — the same
 * coordinate the read-line plugin stores when that block is marked read.
 * All failures return 0 / reveal immediately: buffering must suppress
 * presentation, never existence.
 */

/**
 * The reveal breakpoint for a held answer: the content end of the block
 * containing the anchor's end position. Returns 0 (fail-open: reveal
 * immediately) when the position cannot be resolved to a block.
 */
export function answerBreakpointPos(doc: PMNode, anchor: { to: number }): number {
  try {
    const clamped = Math.max(0, Math.min(anchor.to, doc.content.size))
    const $pos = doc.resolve(clamped)
    if ($pos.depth > 0) return $pos.end($pos.depth)
  } catch {
    // fall through — never let a stale anchor hide an answer
  }
  return 0
}

/**
 * How long a held answer may wait when there is NO read-line signal at all
 * (highWaterMark === 0): an estimate of the time needed to read the anchor
 * block at ~250 wpm, clamped to [2s, 15s].
 */
export function answerDwellMs(blockText: string): number {
  const trimmed = blockText.trim()
  const words = trimmed ? trimmed.split(/\s+/).length : 0
  return Math.min(15000, Math.max(2000, (words / 250) * 60000))
}

export interface AnswerRevealInput {
  /** Read-line plugin high-water mark (0 = no reading tracked). */
  highWaterMark: number
  /** answerBreakpointPos result (0 = unresolvable — fail-open). */
  breakpointPos: number
  /** Milliseconds since the answer was held. */
  msSinceHeld: number
  /** answerDwellMs result for the anchor block. */
  dwellMs: number
}

/**
 * Whether a held answer should reveal now:
 * - breakpoint unresolvable (0) → reveal (fail-open);
 * - the read line has crossed the breakpoint → reveal;
 * - no reading signal at all (highWaterMark 0) → reveal after the dwell
 *   timer, so a mark that never moves cannot hold an answer forever;
 * - otherwise keep holding.
 */
export function shouldRevealAnswer({
  highWaterMark,
  breakpointPos,
  msSinceHeld,
  dwellMs,
}: AnswerRevealInput): boolean {
  if (breakpointPos === 0) return true
  if (highWaterMark !== 0 && highWaterMark >= breakpointPos) return true
  if (highWaterMark === 0) return msSinceHeld >= dwellMs
  return false
}
