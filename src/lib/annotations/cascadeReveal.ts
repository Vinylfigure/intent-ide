import type { Node as PMNode } from 'prosemirror-model'
import type { EditorState } from 'prosemirror-state'
import { findBlockById } from '@/lib/prosemirror/blockIds'
import { readLinePluginKey } from '@/lib/prosemirror/plugins/readLinePlugin'
import { getProposedAnchors } from '@/lib/prosemirror/plugins/proposedChangePlugin'
import type { ProposedEdit, ProposedEditRelation } from './types'

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
export interface CascadeRevealPartition<T = ProposedEdit> {
  /** Edits to show now. */
  reveal: T[]
  /** Cascades held back until the read-line crosses `breakpointPos`. */
  held: T[]
}

export function partitionCascadeReveal<T extends Pick<ProposedEdit, 'relation' | 'from'>>(
  edits: T[],
  highWaterMark: number,
  breakpointPos: number,
): CascadeRevealPartition<T> {
  if (highWaterMark === 0 || highWaterMark >= breakpointPos) {
    return { reveal: edits, held: [] }
  }
  const reveal: T[] = []
  const held: T[] = []
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

/**
 * One tick of the flow-state hold poll, computed from LIVE plugin anchors —
 * positions are re-mapped through every transaction, so both the ABOVE/BELOW
 * partition and the breakpoint (the primary anchor's live block end) track
 * the document as the user types during a hold, instead of freezing at the
 * stale stored from/to captured at proposal time.
 *
 * Returns the ids of currently-HELD (unrevealed) anchors that should reveal
 * now; empty array when nothing is held or nothing is ready.
 */
export function pollCascadeReveal(state: EditorState): string[] {
  const anchors = getProposedAnchors(state)
  const heldNow: Array<{ id: string; relation: ProposedEditRelation; from: number }> = []
  let primary: { to: number; blockId?: string } | undefined
  for (const [id, a] of anchors) {
    if (a.relation === 'primary') primary = { to: a.to, blockId: a.blockId }
    if (!a.revealed) heldNow.push({ id, relation: a.relation, from: a.from })
  }
  if (heldNow.length === 0) return []
  const highWaterMark = readLinePluginKey.getState(state)?.highWaterMark ?? 0
  const breakpoint = cascadeBreakpointPos(state.doc, primary)
  const { reveal } = partitionCascadeReveal(heldNow, highWaterMark, breakpoint)
  return reveal.map((e) => e.id)
}
