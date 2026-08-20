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
import {
  applyProposedEdits,
  applySingleEdit,
  findAppliedEditFinalPosition,
  findTextInDoc,
} from '../applyProposedEdits'
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
 * #44: `AppliedEdit.from/to` (as returned in `result.applied`) are the
 * positions passed to `tr.replaceWith` at DISPATCH time — valid post-
 * transaction only for the lowest-`from` edit in the batch, since edits
 * dispatch descending by `from` and that one lands last. Any other edit's
 * `AppliedEdit` position can be shifted by a different-length edit at a
 * lower position applied after it. `findAppliedEditFinalPosition` re-derives
 * the TRUE final position by ARITHMETIC over the batch's own deltas — a
 * fingerprint-search-based first attempt was rejected on review because a
 * short/common `newText` (a single corrected word or character) can
 * coincidentally match pre-existing text elsewhere in the same block,
 * silently returning the WRONG occurrence.
 */
describe('findAppliedEditFinalPosition — true post-transaction position, by arithmetic not text search (#44)', () => {
  // b1 'one two three' (13 chars) at 1..14; b2 'alpha beta gamma' (16 chars)
  // at 16..32.
  function makeShrinkDoc(): PMNode {
    return schema.node('doc', null, [
      p('b1', 'one two three'),
      p('b2', 'alpha beta gamma'),
    ])
  }

  it('a lower-position, different-length cascade shifts the primary — result.applied is stale, arithmetic gives the true position', () => {
    const view = mount(makeShrinkDoc())
    const betaRange = findTextInDoc(view.state.doc, 'beta')!
    const cascadeRange = findTextInDoc(view.state.doc, 'one two three')!
    const primary = edit({
      id: 'primary_1',
      from: betaRange.from,
      to: betaRange.to,
      targetText: 'beta',
      newText: 'B',
      relation: 'primary',
      blockId: 'b2',
      severity: 'must',
    })
    const cascade = edit({
      id: 'cascade_1',
      from: cascadeRange.from,
      to: cascadeRange.to,
      targetText: 'one two three',
      newText: 'X',
      blockId: 'b1',
    })
    setProposedEdits(view, [primary, cascade])

    const result = applyProposedEdits(view, ['primary_1', 'cascade_1'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(view.state.doc.textContent).toBe('Xalpha B gamma')

    // result.applied still reports the stale, pre-transaction dispatch
    // position — correct for the ledger entries, not a valid live position
    // once the earlier cascade shrinks the doc by 12 chars.
    const appliedPrimary = result.applied.find((ap) => ap.id === 'primary_1')!
    expect(appliedPrimary).toMatchObject(betaRange)

    const truePos = findAppliedEditFinalPosition(appliedPrimary, result.applied)
    expect(truePos).toEqual({ from: betaRange.from - 12, to: betaRange.from - 12 + 1 })
    expect(view.state.doc.textBetween(truePos.from, truePos.to)).toBe('B')
    // Trusting the stale result.applied position would read past the end of
    // the now-shrunk document entirely.
    expect(view.state.doc.content.size).toBeLessThan(appliedPrimary.to)
  })

  it('a false-positive-prone collision (newText also occurs earlier in the same block) does not fool it — no text search happens at all (#44 review finding)', () => {
    // b2 deliberately contains a decoy 'B' BEFORE the real edit target — the
    // exact shape that broke a fingerprint-search-based first attempt: a
    // block-scoped search for 'B' on the post-dispatch doc returns this
    // decoy's position, not the real edit's.
    const doc = schema.node('doc', null, [
      p('b1', 'one two three'),
      p('b2', 'B is a letter. alpha beta gamma'),
    ])
    const view = mount(doc)
    const betaRange = findTextInDoc(view.state.doc, 'beta')!
    const cascadeRange = findTextInDoc(view.state.doc, 'one two three')!
    const decoyB = findTextInDoc(view.state.doc, 'B')!
    expect(decoyB.from).toBeLessThan(betaRange.from) // confirms the decoy sorts first

    const primary = edit({
      id: 'primary_1',
      from: betaRange.from,
      to: betaRange.to,
      targetText: 'beta',
      newText: 'B',
      relation: 'primary',
      blockId: 'b2',
      severity: 'must',
    })
    const cascade = edit({
      id: 'cascade_1',
      from: cascadeRange.from,
      to: cascadeRange.to,
      targetText: 'one two three',
      newText: 'X',
      blockId: 'b1',
    })
    setProposedEdits(view, [primary, cascade])

    const result = applyProposedEdits(view, ['primary_1', 'cascade_1'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const appliedPrimary = result.applied.find((ap) => ap.id === 'primary_1')!
    const truePos = findAppliedEditFinalPosition(appliedPrimary, result.applied)
    // The arithmetic-derived position is the REAL edited 'B' (immediately
    // after 'alpha '), not the decoy at the start of the block.
    expect(view.state.doc.textBetween(Math.max(0, truePos.from - 6), truePos.from)).toBe('alpha ')
    expect(view.state.doc.textBetween(truePos.from, truePos.to)).toBe('B')
  })

  it('an edit at a HIGHER position (dispatched before target, per descending order) does not shift it', () => {
    const target = { id: 't', from: 10, to: 10, newText: 'X', targetText: '', blockId: null }
    const higherCascade = { id: 'h', from: 50, to: 55, newText: 'YY', targetText: 'ZZZZZ', blockId: null }
    expect(findAppliedEditFinalPosition(target, [target, higherCascade])).toEqual({ from: 10, to: 11 })
  })

  it('sums deltas from multiple lower-position edits, both shrinking and growing', () => {
    const target = { id: 't', from: 50, to: 54, newText: 'Q', targetText: 'wxyz', blockId: null }
    const shrink = { id: 's', from: 0, to: 5, newText: 'AB', targetText: 'ABCDE', blockId: null } // delta -3
    const grow = { id: 'g', from: 10, to: 10, newText: 'ABCD', targetText: '', blockId: null } // delta +4
    // net shift = -3 + 4 = +1
    expect(findAppliedEditFinalPosition(target, [target, shrink, grow])).toEqual({ from: 51, to: 52 })
  })

  it('a pure deletion (newText === "") resolves to a zero-length range at its shifted position', () => {
    const target = { id: 't', from: 20, to: 24, newText: '', targetText: 'abcd', blockId: null }
    const shrink = { id: 's', from: 0, to: 10, newText: '', targetText: 'ZZZZZZZZZZ', blockId: null } // delta -10
    expect(findAppliedEditFinalPosition(target, [target, shrink])).toEqual({ from: 10, to: 10 })
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
