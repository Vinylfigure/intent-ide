import type { Node as PMNode } from 'prosemirror-model'
import { findBlockById } from '@/lib/prosemirror/blockIds'
import type { ProposedEdit } from './types'

/**
 * Flow-state buffering for cascade reveals (core PRD rule): downstream
 * cascade callouts must not yank the reader's attention mid-paragraph. On
 * reveal-time the edit set is split:
 *
 * - the PRIMARY edit always shows immediately (it is the user's own intent);
 * - cascades ABOVE the read-line high-water mark show immediately — content
 *   the user already read has changed, and the PRD requires that to flag;
 * - cascades BELOW the read-line are HELD until the high-water mark crosses
 *   the end of the primary edit's block (a coarse, natural breakpoint).
 *
 * highWaterMark === 0 means no reading has been tracked yet (fresh session,
 * short doc that never scrolled, headless/e2e flows) — everything reveals
 * immediately: with no reading signal there is no flow state to protect,
 * and holding cascades forever behind a mark that may never move would
 * silently hide review surfaces.
 */
export interface CascadeRevealPartition {
  /** Edits to show now. */
  reveal: ProposedEdit[]
  /** Cascades held back until the read-line crosses `breakpointPos`. */
  held: ProposedEdit[]
}

export function partitionCascadeReveal(
  edits: ProposedEdit[],
  highWaterMark: number,
  breakpointPos: number,
): CascadeRevealPartition {
  if (highWaterMark === 0 || highWaterMark >= breakpointPos) {
    return { reveal: edits, held: [] }
  }
  const reveal: ProposedEdit[] = []
  const held: ProposedEdit[] = []
  for (const edit of edits) {
    if (edit.relation === 'primary' || edit.from < highWaterMark) {
      reveal.push(edit)
    } else {
      held.push(edit)
    }
  }
  return { reveal, held }
}

/**
 * The coarse reveal breakpoint: the END of the primary edit's block, in the
 * same coordinate the read-line plugin stores (the block's content end, i.e.
 * what `$pos.end(depth)` yields when that block is marked read). Prefers the
 * primary edit's blockId; falls back to resolving the edit's position; a
 * missing primary or unresolvable position returns 0 so everything reveals
 * immediately — failures must never hide review surfaces.
 */
export function cascadeBreakpointPos(
  doc: PMNode,
  primary: Pick<ProposedEdit, 'to' | 'blockId'> | undefined,
): number {
  if (!primary) return 0
  if (primary.blockId) {
    const found = findBlockById(doc, primary.blockId)
    // Content end of the block node: pos + nodeSize - 1.
    if (found) return found.pos + found.node.nodeSize - 1
  }
  try {
    const clamped = Math.max(0, Math.min(primary.to, doc.content.size))
    const $pos = doc.resolve(clamped)
    if ($pos.depth > 0) return $pos.end($pos.depth)
  } catch {
    // fall through
  }
  return 0
}
