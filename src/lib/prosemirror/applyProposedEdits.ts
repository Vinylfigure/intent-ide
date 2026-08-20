import type { EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { getProposedAnchors } from './plugins/proposedChangePlugin'
import { blockTextRange, findTextInDoc } from './blockIds'

// Compat re-export: findTextInDoc moved to blockIds.ts (the proposedChange
// plugin needs it for re-anchoring, and importing it from here would cycle).
export { findTextInDoc } from './blockIds'

/**
 * Applies a set of accepted proposed edits in ONE transaction, safely.
 *
 * Multi-region edits carry positions captured at proposal time; the document may
 * have changed since (the user typed, an earlier edit applied). So each edit is
 * re-resolved at apply time: prefer the live, transaction-mapped anchor from the
 * proposedChange plugin; validate the range still holds `targetText`; if it
 * drifted, recover by fingerprint-searching the doc for `targetText`. If any edit
 * can't be validated or recovered, the WHOLE transaction is aborted — never apply
 * a stale range and corrupt the document. Surviving edits are applied descending
 * by `from` so earlier positions stay valid.
 */

/**
 * Transaction meta stamped on every AI-driven batched apply. The direct-edit
 * cascade trigger (src/lib/annotations/directEditTrigger.ts) skips stamped
 * transactions so applying an AI cascade never re-offers a cascade on itself.
 */
export const AI_APPLY_META = 'intent-ide:ai-apply'

export interface AppliedEdit {
  /** The proposed edit's id — lets callers attribute ledger rows precisely. */
  id: string
  from: number
  to: number
  newText: string
  targetText: string
  blockId?: string | null
}

export type ApplyProposedResult =
  | { ok: true; applied: AppliedEdit[] }
  | { ok: false; reason: string }

/**
 * True if the live text immediately before/after `pos` still matches the
 * verbatim snippet captured when the insertion was proposed. Insertions have
 * no target text to fingerprint-search for, so this is the only apply-time
 * drift check available for them.
 *
 * The comparison window is re-derived from the RECORDED `beforeSpan`/`afterSpan`
 * position distances (never from the captured strings' length, and never from
 * a fresh doc-size-based radius clamp):
 * - Length-based reconstruction breaks across block boundaries, where doc
 *   positions include non-character slots that don't correspond to characters.
 * - A fresh `min(doc.content.size, pos + RADIUS)` clamp breaks whenever the
 *   document's total size changes between proposal and apply for ANY reason
 *   (e.g. text typed far away, near the end of the doc) — the window would
 *   silently grow or shrink to include content that didn't exist at capture
 *   time, producing a spurious mismatch even though nothing near `pos` moved.
 * Reusing the exact spans captured at proposal time keeps the window's SIZE
 * stable; only its clamp to the live `doc.content.size` can shrink it, which
 * is itself a correct drift signal (the document got shorter near `pos`).
 */
function insertionContextMatches(
  doc: PMNode,
  pos: number,
  ctx: { before: string; after: string; beforeSpan: number; afterSpan: number },
): boolean {
  const from = Math.max(0, pos - ctx.beforeSpan)
  const to = Math.min(doc.content.size, pos + ctx.afterSpan)
  return doc.textBetween(from, pos) === ctx.before && doc.textBetween(pos, to) === ctx.after
}

export function applyProposedEdits(view: EditorView, acceptedIds: string[]): ApplyProposedResult {
  const anchors = getProposedAnchors(view.state)
  const doc = view.state.doc
  const resolved: AppliedEdit[] = []

  for (const id of acceptedIds) {
    // NOTE: the plugin always holds the FULL edit set (flow-state holds are a
    // revealed:false flag, never a missing anchor), so an accepted id whose
    // anchor is still unrevealed is perfectly valid to apply — the commit
    // modal shows every edit, so accepting one there is a conscious decision.
    const a = anchors.get(id)
    if (!a) return { ok: false, reason: `Proposed edit ${id} no longer exists.` }

    // No-op edits (targetText === newText — e.g. the direct-edit cascade's
    // pre-rejected primary placeholder, or a proposal that matches the text
    // verbatim) are excluded from the transaction AND from `applied`, so they
    // never fabricate change entries or audit rows. They are NOT a validation
    // failure — accepting one is harmless.
    if (a.targetText === a.newText) continue

    const safeFrom = Math.min(a.from, doc.content.size)
    const safeTo = Math.min(a.to, doc.content.size)

    // Insertions (targetText:'' ⇒ from === to) have no target text to fingerprint,
    // so the textBetween check below would trivially pass regardless of drift.
    // Validate against the before/after context captured at proposal time instead;
    // there is no fingerprint recovery for an insertion (nothing to search for), so
    // a mismatch aborts the whole transaction — same fail-closed contract as every
    // other edit kind. Edits from before this check existed carry no context and
    // fall through unvalidated (unchanged legacy behavior).
    if (safeFrom === safeTo && a.targetText === '') {
      if (a.insertionContext && !insertionContextMatches(doc, safeFrom, a.insertionContext)) {
        return {
          ok: false,
          reason: 'Could not safely place an insertion — the surrounding text has changed. Re-run the annotation.',
        }
      }
      resolved.push({ id, from: safeFrom, to: safeTo, newText: a.newText, targetText: a.targetText, blockId: a.blockId ?? null })
      continue
    }

    const current = safeFrom <= safeTo ? doc.textBetween(safeFrom, safeTo) : ''
    if (current === a.targetText) {
      resolved.push({ id, from: safeFrom, to: safeTo, newText: a.newText, targetText: a.targetText, blockId: a.blockId ?? null })
      continue
    }

    // Range drifted — recover by fingerprint match on the expected text,
    // scoped to the edit's block when we know it (a phrase repeated in two
    // blocks must not silently recover into the wrong one).
    const found =
      (a.blockId ? blockTextRange(doc, a.blockId, a.targetText) : null) ??
      findTextInDoc(doc, a.targetText)
    if (!found) {
      return {
        ok: false,
        reason: `Could not safely place an edit — the text "${a.targetText.slice(0, 40)}…" has changed. Re-run the annotation.`,
      }
    }
    resolved.push({ id, from: found.from, to: found.to, newText: a.newText, targetText: a.targetText, blockId: a.blockId ?? null })
  }

  // All accepted ids were no-ops → nothing to dispatch, nothing applied.
  if (resolved.length === 0) return { ok: true, applied: [] }

  // Apply descending by `from` so each replace leaves earlier positions valid.
  const ordered = [...resolved].sort((x, y) => y.from - x.from)
  let tr = view.state.tr
  tr.setMeta(AI_APPLY_META, true)
  for (const e of ordered) {
    tr = e.newText
      ? tr.replaceWith(e.from, e.to, view.state.schema.text(e.newText))
      : tr.delete(e.from, e.to)
  }
  view.dispatch(tr)

  return { ok: true, applied: resolved }
}
