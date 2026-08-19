// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'
import { applySingleEdit } from '@/lib/prosemirror/applyProposedEdits'
import { refreshAnchorAfterApply } from '../anchoring'
import type { TextAnchor } from '../types'

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
