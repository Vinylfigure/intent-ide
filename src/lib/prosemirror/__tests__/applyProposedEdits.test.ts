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
import { applyProposedEdits } from '../applyProposedEdits'
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
