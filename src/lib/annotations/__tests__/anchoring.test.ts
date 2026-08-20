// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'
import { applySingleEdit } from '@/lib/prosemirror/applyProposedEdits'
import { refreshAnchorAfterApply, refreshedAnchorForMultiRegionApply } from '../anchoring'
import type { TextAnchor, ProposedEdit } from '../types'
import type { AppliedEdit } from '@/lib/prosemirror/applyProposedEdits'

function p(blockId: string, text: string): PMNode {
  return schema.node('paragraph', { blockId }, [schema.text(text)])
}

function makeDoc(): PMNode {
  return schema.node('doc', null, [p('b1', 'alpha beta gamma')])
}

const views: EditorView[] = []

function mount(doc: PMNode): EditorView {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const state = EditorState.create({ schema, doc })
  const view: EditorView = new EditorView(host, {
    state,
    dispatchTransaction(transaction) {
      view.updateState(view.state.apply(transaction))
    },
  })
  views.push(view)
  return view
}

afterEach(() => {
  while (views.length) views.pop()!.destroy()
})

describe('refreshAnchorAfterApply', () => {
  it('re-anchors from/to/text to the applied edit, preserving scope', () => {
    const anchor: TextAnchor = { from: 1, to: 17, scope: 'sentence', text: 'alpha beta gamma' }
    const next = refreshAnchorAfterApply(anchor, { from: 1, to: 17, newText: 'ALPHA' })
    expect(next).toEqual({ from: 1, to: 6, scope: 'sentence', text: 'ALPHA' })
  })

  it('re-anchors to a RECOVERED position, not the original from/to', () => {
    const anchor: TextAnchor = { from: 1, to: 17, scope: 'sentence', text: 'alpha beta gamma' }
    // Simulates a fingerprint-recovered apply that landed somewhere else.
    const next = refreshAnchorAfterApply(anchor, { from: 30, to: 35, newText: 'OMEGA' })
    expect(next).toEqual({ from: 30, to: 35, scope: 'sentence', text: 'OMEGA' })
  })
})

function proposedEdit(overrides: Partial<ProposedEdit> & { id: string }): ProposedEdit {
  return {
    from: 0,
    to: 0,
    newText: '',
    reason: 'test',
    relation: 'cascade',
    status: 'pending',
    targetText: '',
    severity: 'probably',
    evidence: null,
    ...overrides,
  }
}

function appliedEdit(overrides: Partial<AppliedEdit> & { id: string }): AppliedEdit {
  return { from: 0, to: 0, newText: '', targetText: '', ...overrides }
}

/**
 * #44 (review round 2): the multi-region apply's anchor refresh, extracted
 * to one pure function so the actual apply-time WIRING (finding the applied
 * primary among a mixed proposed/applied batch, and only refreshing for a
 * real, applicable primary) has direct regression coverage — not just the
 * underlying position arithmetic (`findAppliedEditFinalPosition`, covered
 * separately in applyProposedEdits.test.ts).
 */
describe('refreshedAnchorForMultiRegionApply', () => {
  const anchor: TextAnchor = { from: 5, to: 9, scope: 'phrase', text: 'beta' }

  it('refreshes the anchor to the primary edit true final position, shifted by an earlier cascade', () => {
    const proposed = [
      proposedEdit({ id: 'primary_1', relation: 'primary', newText: 'B' }),
      proposedEdit({ id: 'cascade_1', relation: 'cascade', newText: 'X' }),
    ]
    // primary at from=22 (pre-transaction); an earlier cascade (from=1..14,
    // newText 'X') shrinks the doc by 12 before it — true position is 10.
    const appliedEdits = [
      appliedEdit({ id: 'primary_1', from: 22, to: 26, newText: 'B' }),
      appliedEdit({ id: 'cascade_1', from: 1, to: 14, newText: 'X' }),
    ]
    const next = refreshedAnchorForMultiRegionApply(anchor, proposed, appliedEdits)
    expect(next).toEqual({ from: 10, to: 11, scope: 'phrase', text: 'B' })
  })

  it('returns undefined when no proposed edit is tagged relation: primary', () => {
    const proposed = [proposedEdit({ id: 'cascade_1', relation: 'cascade', newText: 'X' })]
    const appliedEdits = [appliedEdit({ id: 'cascade_1', from: 1, to: 14, newText: 'X' })]
    expect(refreshedAnchorForMultiRegionApply(anchor, proposed, appliedEdits)).toBeUndefined()
  })

  it('returns undefined when the primary was rejected (not in appliedEdits)', () => {
    const proposed = [
      proposedEdit({ id: 'primary_1', relation: 'primary', newText: 'B' }),
      proposedEdit({ id: 'cascade_1', relation: 'cascade', newText: 'X' }),
    ]
    // Only the cascade was accepted/applied — the primary is absent.
    const appliedEdits = [appliedEdit({ id: 'cascade_1', from: 1, to: 14, newText: 'X' })]
    expect(refreshedAnchorForMultiRegionApply(anchor, proposed, appliedEdits)).toBeUndefined()
  })

  it('returns undefined when the primary was a no-op (excluded from appliedEdits by applyProposedEdits)', () => {
    const proposed = [proposedEdit({ id: 'primary_1', relation: 'primary', newText: 'beta' })]
    // applyProposedEdits already excludes no-ops (targetText === newText)
    // from `applied` — simulated here by an empty appliedEdits array.
    expect(refreshedAnchorForMultiRegionApply(anchor, proposed, [])).toBeUndefined()
  })

  it('returns undefined for a pure-deletion primary — no text to validate a future re-apply against', () => {
    const proposed = [proposedEdit({ id: 'primary_1', relation: 'primary', newText: '' })]
    const appliedEdits = [appliedEdit({ id: 'primary_1', from: 5, to: 9, newText: '' })]
    expect(refreshedAnchorForMultiRegionApply(anchor, proposed, appliedEdits)).toBeUndefined()
  })
})

/**
 * #42 review finding: without refreshing `annotation.anchor` after a
 * successful apply, a second apply on the same annotation (the "Tweak it"
 * flow — ResolutionActions/ConversationThread both validate a re-apply's
 * targetText against `annotation.anchor.text`) would fail-closed forever,
 * because parseSuggestedEdit always derives a fresh suggestion's from/to from
 * the annotation's anchor, and the SECOND apply's targetText would still be
 * the FIRST apply's pre-apply text — already replaced in the live doc.
 * This reproduces that two-apply sequence end to end through applySingleEdit
 * + refreshAnchorAfterApply (the exact mechanism the two call sites use) to
 * prove a tweak-and-reapply now succeeds instead of aborting.
 */
describe('applySingleEdit + refreshAnchorAfterApply — tweak-and-reapply sequence (#42)', () => {
  it('a second apply succeeds when the anchor was refreshed after the first', () => {
    const view = mount(makeDoc())
    let anchor: TextAnchor = { from: 1, to: 17, scope: 'sentence', text: 'alpha beta gamma' }

    const first = applySingleEdit(view, {
      id: 'a',
      from: anchor.from,
      to: anchor.to,
      newText: 'ALPHA BETA GAMMA',
      targetText: anchor.text,
      blockId: 'b1',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    anchor = refreshAnchorAfterApply(anchor, first.applied[0])
    expect(view.state.doc.textContent).toBe('ALPHA BETA GAMMA')

    // "Tweak it": parseSuggestedEdit derives the new suggestion's from/to from
    // the (now-refreshed) anchor, and targetText is the (now-refreshed) anchor.text.
    const second = applySingleEdit(view, {
      id: 'a',
      from: anchor.from,
      to: anchor.to,
      newText: 'ALPHA GAMMA',
      targetText: anchor.text,
      blockId: 'b1',
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(view.state.doc.textContent).toBe('ALPHA GAMMA')
  })

  it('WITHOUT the anchor refresh, the same second apply would fail-closed (regression guard)', () => {
    const view = mount(makeDoc())
    const staleAnchor: TextAnchor = { from: 1, to: 17, scope: 'sentence', text: 'alpha beta gamma' }

    const first = applySingleEdit(view, {
      id: 'a',
      from: staleAnchor.from,
      to: staleAnchor.to,
      newText: 'ALPHA BETA GAMMA',
      targetText: staleAnchor.text,
      blockId: 'b1',
    })
    expect(first.ok).toBe(true)

    // Deliberately reuse the STALE (pre-apply) anchor, as the code did before
    // this fix — the live doc no longer contains 'alpha beta gamma'.
    const second = applySingleEdit(view, {
      id: 'a',
      from: staleAnchor.from,
      to: staleAnchor.to,
      newText: 'ALPHA GAMMA',
      targetText: staleAnchor.text,
      blockId: 'b1',
    })
    expect(second.ok).toBe(false)
  })
})
