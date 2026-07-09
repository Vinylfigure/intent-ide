import type { EditorView } from 'prosemirror-view'
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

export interface AppliedEdit {
  from: number
  to: number
  newText: string
  targetText: string
  blockId?: string | null
}

export type ApplyProposedResult =
  | { ok: true; applied: AppliedEdit[] }
  | { ok: false; reason: string }

export function applyProposedEdits(view: EditorView, acceptedIds: string[]): ApplyProposedResult {
  const anchors = getProposedAnchors(view.state)
  const doc = view.state.doc
  const resolved: AppliedEdit[] = []

  for (const id of acceptedIds) {
    const a = anchors.get(id)
    if (!a) return { ok: false, reason: `Proposed edit ${id} no longer exists.` }

    const safeFrom = Math.min(a.from, doc.content.size)
    const safeTo = Math.min(a.to, doc.content.size)
    const current = safeFrom <= safeTo ? doc.textBetween(safeFrom, safeTo) : ''

    if (current === a.targetText) {
      resolved.push({ from: safeFrom, to: safeTo, newText: a.newText, targetText: a.targetText, blockId: a.blockId ?? null })
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
    resolved.push({ from: found.from, to: found.to, newText: a.newText, targetText: a.targetText, blockId: a.blockId ?? null })
  }

  // Apply descending by `from` so each replace leaves earlier positions valid.
  const ordered = [...resolved].sort((x, y) => y.from - x.from)
  let tr = view.state.tr
  for (const e of ordered) {
    tr = e.newText
      ? tr.replaceWith(e.from, e.to, view.state.schema.text(e.newText))
      : tr.delete(e.from, e.to)
  }
  view.dispatch(tr)

  return { ok: true, applied: resolved }
}
