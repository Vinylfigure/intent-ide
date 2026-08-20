// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '../schema'
import {
  createProposedChangePlugin,
  setProposedEdits,
} from '../plugins/proposedChangePlugin'
import { applyProposedEdits, applySingleEdit } from '../applyProposedEdits'
import { blockTextRange } from '../blockIds'
import { captureInsertionContext } from '@/lib/ai/orchestrator'
import type { ProposedEdit } from '@/lib/annotations/types'

/**
 * M5 regression suite: no-op edits (targetText === newText — e.g. the
 * direct-edit cascade's pre-rejected primary placeholder) must be excluded
 * from the apply transaction AND from the returned `applied` array, so they
 * never fabricate change-ledger entries — without ever failing validation.
 */

function p(blockId: string, text: string): PMNode {
  return schema.node('paragraph', { blockId }, [schema.text(text)])
}

// b1 content 1..17, b2 19..35.
function makeDoc(): PMNode {
  return schema.node('doc', null, [
    p('b1', 'alpha beta gamma'),
    p('b2', 'delta beta omega'),
  ])
}

const views: EditorView[] = []
let dispatchCount = 0

function mount(doc: PMNode): EditorView {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const state = EditorState.create({ schema, doc, plugins: [createProposedChangePlugin()] })
  const view: EditorView = new EditorView(host, {
    state,
    dispatchTransaction(transaction) {
      dispatchCount++
      const newState = view.state.apply(transaction)
      view.updateState(newState)
    },
  })
  views.push(view)
  dispatchCount = 0
  return view
}

afterEach(() => {
  while (views.length) views.pop()!.destroy()
})

function edit(overrides: Partial<ProposedEdit> & { id: string }): ProposedEdit {
  return {
    from: 1,
    to: 2,
    newText: 'replacement',
    reason: 'test',
    relation: 'cascade',
    status: 'pending',
    targetText: 'target',
    severity: 'probably',
    evidence: null,
    ...overrides,
  }
}

// "alpha" in b1 at 1..6; whole b1 content at 1..17; "omega" in b2 at 30..35.
const noopPrimary = () =>
  edit({
    id: 'pe_noop',
    from: 1,
    to: 17,
    targetText: 'alpha beta gamma',
    newText: 'alpha beta gamma', // targetText === newText → no-op
    relation: 'primary',
    blockId: 'b1',
    severity: 'must',
    status: 'rejected',
  })
const realCascade = () =>
  edit({ id: 'pe_real', from: 30, to: 35, targetText: 'omega', newText: 'OMEGA', blockId: 'b2' })

describe('applyProposedEdits — no-op exclusion (M5)', () => {
  it('mixed no-op + real: only the real edit is applied and returned', () => {
    const view = mount(makeDoc())
    setProposedEdits(view, [noopPrimary(), realCascade()])

    const result = applyProposedEdits(view, ['pe_noop', 'pe_real'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.applied).toHaveLength(1)
    expect(result.applied[0].id).toBe('pe_real')
    expect(result.applied[0].newText).toBe('OMEGA')
    // The real edit landed; the no-op region is untouched.
    expect(view.state.doc.textContent).toBe('alpha beta gammadelta beta OMEGA')
  })

  it('all-accepted-ids-are-no-ops: ok with empty applied and NO transaction dispatched', () => {
    const view = mount(makeDoc())
    setProposedEdits(view, [noopPrimary(), realCascade()])
    const before = view.state.doc
    const dispatchesBefore = dispatchCount

    const result = applyProposedEdits(view, ['pe_noop'])
    expect(result).toEqual({ ok: true, applied: [] })
    // No doc change and no dispatch at all — nothing to record anywhere.
    expect(view.state.doc.eq(before)).toBe(true)
    expect(dispatchCount).toBe(dispatchesBefore)
  })

  it('a no-op whose stored range has drifted never fails validation (skipped, not aborted)', () => {
    const view = mount(makeDoc())
    // Set valid edits first, THEN drift the no-op's region by editing the doc:
    // replace "alpha" (1..6) so the no-op anchor's mapped range no longer holds
    // its targetText — the state a real user creates by typing over the block.
    // The plugin maps both anchors through the transaction, so pe_real stays valid.
    setProposedEdits(view, [noopPrimary(), realCascade()])
    view.dispatch(view.state.tr.replaceWith(1, 6, view.state.schema.text('ALTERED')))

    const result = applyProposedEdits(view, ['pe_noop', 'pe_real'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.applied.map((a) => a.id)).toEqual(['pe_real'])
    expect(view.state.doc.textContent).toBe('ALTERED beta gammadelta beta OMEGA')
  })
})

/**
 * #42: the single-suggestion apply paths (ResolutionActions.applyConfirmedEdit's
 * fallback, ConversationThread.handleApplyEdit) never went through
 * applyProposedEdits at all — a raw, unvalidated replaceWith with no re-check
 * that the live doc still matched what was proposed. applySingleEdit gives
 * those call sites the identical fail-closed fingerprint/block-scoped-recovery
 * contract, for one ad-hoc edit that isn't registered in the plugin's anchors.
 */
describe('applySingleEdit — drift validation for the single-suggestion apply path (#42)', () => {
  it('applies cleanly when the live range still matches targetText', () => {
    const view = mount(makeDoc())
    const before = view.state.doc

    const result = applySingleEdit(view, {
      id: 'single_1',
      from: 1,
      to: 17,
      newText: 'ALPHA BETA GAMMA',
      targetText: 'alpha beta gamma',
      blockId: 'b1',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.applied).toHaveLength(1)
    expect(result.applied[0]).toMatchObject({ id: 'single_1', from: 1, to: 17, newText: 'ALPHA BETA GAMMA' })
    expect(view.state.doc.textContent).toBe('ALPHA BETA GAMMAdelta beta omega')
    expect(view.state.doc.eq(before)).toBe(false)
  })

  it('recovers by block-scoped fingerprint when the stored range has drifted', () => {
    const view = mount(makeDoc())
    // "omega" really lives at 30..35 in b2, but the caller's stored range is
    // stale (e.g. an earlier apply in the same session shifted positions) —
    // this mirrors the applyProposedEdits recovery path, now exercised for a
    // single ad-hoc edit with no plugin anchor to remap it.
    const result = applySingleEdit(view, {
      id: 'single_2',
      from: 0,
      to: 0,
      newText: 'OMEGA',
      targetText: 'omega',
      blockId: 'b2',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.applied[0]).toMatchObject({ from: 30, to: 35, newText: 'OMEGA' })
    expect(view.state.doc.textContent).toBe('alpha beta gammadelta beta OMEGA')
  })

  it('aborts — never misapplies — when targetText can no longer be found anywhere', () => {
    const view = mount(makeDoc())
    const before = view.state.doc
    const dispatchesBefore = dispatchCount

    const result = applySingleEdit(view, {
      id: 'single_3',
      from: 1,
      to: 17,
      newText: 'REPLACEMENT',
      targetText: 'this text was never in the document',
      blockId: 'b1',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/could not safely place/i)
    // Fail-closed: no partial/wrong-range mutation, no dispatch at all.
    expect(view.state.doc.eq(before)).toBe(true)
    expect(dispatchCount).toBe(dispatchesBefore)
  })

  it('a no-op (targetText === newText) applies nothing and dispatches nothing', () => {
    const view = mount(makeDoc())
    const before = view.state.doc
    const dispatchesBefore = dispatchCount

    const result = applySingleEdit(view, {
      id: 'single_4',
      from: 1,
      to: 17,
      newText: 'alpha beta gamma',
      targetText: 'alpha beta gamma',
      blockId: 'b1',
    })

    expect(result).toEqual({ ok: true, applied: [] })
    expect(view.state.doc.eq(before)).toBe(true)
    expect(dispatchCount).toBe(dispatchesBefore)
  })
})

/**
 * Regression suite for issue #40: pure insertions (targetText === '',
 * from === to) have no target text to fingerprint, so the textBetween check
 * alone always trivially passes. `insertionContext` (a verbatim before/after
 * snippet captured at proposal time) is the only apply-time drift signal for
 * them; a mismatch must abort the whole transaction like any other edit kind.
 *
 * Uses the real `captureInsertionContext` from orchestrator.ts (not a
 * hand-rolled copy) so these tests exercise the actual capture logic, not a
 * parallel implementation that could silently drift from it.
 */
describe('applyProposedEdits — insertion context drift (issue #40)', () => {
  it('a valid, unchanged insertion applies normally', () => {
    const view = mount(makeDoc())
    const insertPos = blockTextRange(view.state.doc, 'b1', 'beta')!.to // right after "beta", before " gamma"
    const ctx = captureInsertionContext(view.state.doc, insertPos)
    const ins = edit({
      id: 'pe_insert',
      from: insertPos,
      to: insertPos,
      targetText: '',
      newText: ' INSERTED',
      relation: 'primary',
      blockId: 'b1',
      severity: 'must',
      insertionContext: ctx,
    })
    setProposedEdits(view, [ins])

    const result = applyProposedEdits(view, ['pe_insert'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.applied).toHaveLength(1)
    expect(view.state.doc.textContent).toContain('beta INSERTED gamma')
  })

  it('an insertion whose captured context no longer matches the live document is rejected', () => {
    const view = mount(makeDoc())
    const insertPos = blockTextRange(view.state.doc, 'b1', 'beta')!.to
    const ctx = captureInsertionContext(view.state.doc, insertPos)
    const ins = edit({
      id: 'pe_insert',
      from: insertPos,
      to: insertPos,
      targetText: '',
      newText: ' INSERTED',
      relation: 'primary',
      blockId: 'b1',
      severity: 'must',
      insertionContext: ctx,
    })
    setProposedEdits(view, [ins])

    // Mutate text elsewhere within the captured context window (but not at the
    // insertion point itself) — the plugin still maps the anchor's position
    // through the transaction, but the surrounding text it once matched changed.
    const range = blockTextRange(view.state.doc, 'b1', 'alpha')!
    view.dispatch(view.state.tr.replaceWith(range.from, range.to, view.state.schema.text('ALPHA')))
    const before = view.state.doc

    const result = applyProposedEdits(view, ['pe_insert'])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/surrounding text/i)
    // Whole transaction aborted — nothing was dispatched to the document.
    expect(view.state.doc.eq(before)).toBe(true)
  })

  it('an insertion with no captured context (legacy data) still applies unvalidated', () => {
    const view = mount(makeDoc())
    const insertPos = blockTextRange(view.state.doc, 'b1', 'beta')!.to
    const ins = edit({
      id: 'pe_insert',
      from: insertPos,
      to: insertPos,
      targetText: '',
      newText: ' INSERTED',
      relation: 'primary',
      blockId: 'b1',
      severity: 'must',
      // No insertionContext — mirrors edits created before this field existed.
    })
    setProposedEdits(view, [ins])

    const result = applyProposedEdits(view, ['pe_insert'])
    expect(result.ok).toBe(true)
  })

  it('growing the document far from the insertion point does not invalidate an untouched insertion', () => {
    // Regression for a window-clamping bug: re-deriving the validation window
    // from a fresh `min(doc.content.size, pos + RADIUS)` clamp (instead of the
    // captured beforeSpan/afterSpan) made it grow whenever the document's total
    // size changed anywhere — even far from the insertion point — pulling in
    // content that didn't exist at capture time and producing a false mismatch.
    const view = mount(makeDoc())
    const insertPos = blockTextRange(view.state.doc, 'b2', 'omega')!.to // end of the document's text
    const ctx = captureInsertionContext(view.state.doc, insertPos)
    // Clamped by the doc boundary at capture time: far less than the full radius.
    expect(ctx.afterSpan).toBeLessThan(5)
    const ins = edit({
      id: 'pe_insert',
      from: insertPos,
      to: insertPos,
      targetText: '',
      newText: ' NEW',
      relation: 'primary',
      blockId: 'b2',
      severity: 'must',
      insertionContext: ctx,
    })
    setProposedEdits(view, [ins])

    // Append a large new block AFTER the insertion point — grows the document's
    // total size without touching anything the insertion's context captured.
    const filler = p('b3', 'Z'.repeat(80))
    view.dispatch(view.state.tr.insert(view.state.doc.content.size, filler))

    const result = applyProposedEdits(view, ['pe_insert'])
    expect(result.ok).toBe(true)
  })
})
