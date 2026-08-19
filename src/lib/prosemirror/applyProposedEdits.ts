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

interface PendingRange {
  from: number
  to: number
  targetText: string
  blockId?: string | null
}

/**
 * Validates one edit's range against the live doc: unchanged → use it as-is;
 * drifted → recover by fingerprint match (block-scoped first, when known).
 * Shared by the batched (plugin-anchored) and single ad-hoc apply paths so
 * both get the identical fail-closed contract.
 */
function resolveEditRange(
  doc: PMNode,
  edit: PendingRange,
): { ok: true; from: number; to: number } | { ok: false; reason: string } {
  const safeFrom = Math.min(edit.from, doc.content.size)
  const safeTo = Math.min(edit.to, doc.content.size)
  const current = safeFrom <= safeTo ? doc.textBetween(safeFrom, safeTo) : ''

  // Insertions (targetText:'' ⇒ from === to) trivially pass this check —
  // they bypass fingerprint validation entirely (and render no decoration).
  // Known limitation; do not rely on validation for insertion placement.
  if (current === edit.targetText) {
    return { ok: true, from: safeFrom, to: safeTo }
  }

  // Range drifted — recover by fingerprint match on the expected text,
  // scoped to the edit's block when we know it (a phrase repeated in two
  // blocks must not silently recover into the wrong one).
  const found =
    (edit.blockId ? blockTextRange(doc, edit.blockId, edit.targetText) : null) ??
    findTextInDoc(doc, edit.targetText)
  if (!found) {
    return {
      ok: false,
      reason: `Could not safely place an edit — the text "${edit.targetText.slice(0, 40)}…" has changed. Re-run the annotation.`,
    }
  }
  return { ok: true, from: found.from, to: found.to }
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

    const range = resolveEditRange(doc, a)
    if (!range.ok) return range
    resolved.push({ id, from: range.from, to: range.to, newText: a.newText, targetText: a.targetText, blockId: a.blockId ?? null })
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

export interface AdHocEdit {
  /** Caller-supplied id — lets callers attribute change entries/ledger rows. */
  id: string
  from: number
  to: number
  newText: string
  /** Verbatim text this edit expects to replace, captured at proposal time. */
  targetText: string
  blockId?: string | null
}

/**
 * Validates and applies a SINGLE edit that is not registered in the
 * proposedChange plugin — the common single-suggestion resolution path
 * (`ResolutionActions.applyConfirmedEdit`) and per-message conversation-thread
 * edits (`ConversationThread.handleApplyEdit`), neither of which run a
 * cascade batch through `applyProposedEdits`. Same fail-closed fingerprint /
 * block-scoped-recovery contract as the batched path, scoped to one edit, so
 * a document that changed since the edit was proposed aborts instead of
 * silently misapplying.
 */
export function applySingleEdit(view: EditorView, edit: AdHocEdit): ApplyProposedResult {
  // No-op (targetText === newText): nothing to validate or apply — matches
  // the batched path's convention that a non-change is never dispatched or
  // recorded.
  if (edit.targetText === edit.newText) return { ok: true, applied: [] }

  const range = resolveEditRange(view.state.doc, edit)
  if (!range.ok) return range

  const applied: AppliedEdit = {
    id: edit.id,
    from: range.from,
    to: range.to,
    newText: edit.newText,
    targetText: edit.targetText,
    blockId: edit.blockId ?? null,
  }

  let tr = view.state.tr
  tr.setMeta(AI_APPLY_META, true)
  tr = edit.newText
    ? tr.replaceWith(applied.from, applied.to, view.state.schema.text(edit.newText))
    : tr.delete(applied.from, applied.to)
  view.dispatch(tr)

  return { ok: true, applied: [applied] }
}
