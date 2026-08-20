import type { EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { getProposedAnchors } from './plugins/proposedChangePlugin'
import { blockIdAtPos, blockTextRange, findTextInDoc } from './blockIds'

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
  /**
   * See ProposedEdit.insertionContext — the only apply-time drift signal a pure
   * insertion has. Plugin-anchored edits carry it through the proposedChange
   * plugin; ad-hoc single-edit callers do not capture one yet, so their
   * insertions fall through unvalidated (unchanged legacy behavior).
   */
  insertionContext?: { before: string; after: string; beforeSpan: number; afterSpan: number }
}

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

  // Insertions (targetText:'' ⇒ from === to) have no target text to fingerprint,
  // so the textBetween check below would trivially pass regardless of drift.
  // Validate against the before/after context captured at proposal time instead;
  // there is no fingerprint recovery for an insertion (nothing to search for), so
  // a mismatch aborts — same fail-closed contract as every other edit kind. Edits
  // carrying no captured context fall through unvalidated (legacy behavior).
  if (safeFrom === safeTo && edit.targetText === '') {
    if (edit.insertionContext && !insertionContextMatches(doc, safeFrom, edit.insertionContext)) {
      return {
        ok: false,
        reason: 'Could not safely place an insertion — the surrounding text has changed. Re-run the annotation.',
      }
    }
    return { ok: true, from: safeFrom, to: safeTo }
  }

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

/**
 * Re-derives an applied edit's TRUE post-transaction position by ARITHMETIC
 * over the batch's own known deltas, rather than trusting `target.from/to`
 * as-is or fingerprint-searching the post-dispatch doc for `target.newText`.
 *
 * `AppliedEdit.from/to` are the positions passed to `tr.replaceWith` at
 * dispatch time (pre-transaction, per `applyProposedEdits`'s doc comment)
 * and stay valid post-transaction only for the LOWEST-`from` edit in the
 * batch: since edits dispatch descending by `from`, that one is applied
 * LAST, so nothing dispatched after it can shift it. Any edit that isn't
 * the lowest can be shifted by a different-length edit at a lower position
 * applied after it in the same transaction (#44).
 *
 * A fingerprint search for `target.newText` was tried and rejected: the
 * replacement text is often short/common (a single corrected word or
 * character), and can coincidentally match pre-existing text elsewhere in
 * the same block or another edit's own landing text, silently returning the
 * WRONG occurrence. Arithmetic has no such false-positive risk: every OTHER
 * applied edit positioned before `target` (dispatched after it, since
 * dispatch order is descending by `from`) shifts everything from its own
 * `to` onward — including `target`'s already-landed text — by exactly its
 * own length delta (`newText.length - (to - from)`). Summing those deltas
 * gives `target`'s exact final position with no text search at all.
 */
export function findAppliedEditFinalPosition(
  target: AppliedEdit,
  allApplied: AppliedEdit[],
): { from: number; to: number } {
  // `ap.from === target.from` (a tie) is currently unreachable: primary and
  // cascade edits are always non-zero-width (orchestrator.ts rejects an
  // empty targetText/anchor), and the overlap/dedup gates that select which
  // proposed edits survive into a batch treat any two non-zero-width ranges
  // sharing a `from` as overlapping, so at most one of them is ever in
  // `allApplied`. If either invariant ever loosens (e.g. a zero-width
  // primary), this `>=` excludes a tied edit from the shift sum — revisit
  // this boundary then, since it isn't exercised by any test today.
  const shift = allApplied.reduce((sum, ap) => {
    if (ap.id === target.id || ap.from >= target.from) return sum
    return sum + (ap.newText.length - (ap.to - ap.from))
  }, 0)
  const from = target.from + shift
  return { from, to: from + target.newText.length }
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

  const doc = view.state.doc
  const range = resolveEditRange(doc, edit)
  if (!range.ok) return range

  // Recompute blockId from where the edit actually landed rather than
  // trusting the caller's pre-resolution guess: unlike the plugin-anchored
  // batched path (whose blockId was captured at proposal time), this ad-hoc
  // caller's blockId is a live guess at the ORIGINAL (possibly stale) `from`
  // — wrong or null if that guess missed, which would otherwise misattribute
  // the ledger/GraphRAG record to the wrong block.
  const landedBlockId = blockIdAtPos(doc, range.from) ?? edit.blockId ?? null

  const applied: AppliedEdit = {
    id: edit.id,
    from: range.from,
    to: range.to,
    newText: edit.newText,
    targetText: edit.targetText,
    blockId: landedBlockId,
  }

  let tr = view.state.tr
  tr.setMeta(AI_APPLY_META, true)
  tr = edit.newText
    ? tr.replaceWith(applied.from, applied.to, view.state.schema.text(edit.newText))
    : tr.delete(applied.from, applied.to)
  view.dispatch(tr)

  return { ok: true, applied: [applied] }
}
