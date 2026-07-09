// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '../schema'
import {
  createProposedChangePlugin,
  setProposedEdits,
  getProposedAnchors,
} from '../plugins/proposedChangePlugin'
import type { ProposedEdit } from '@/lib/annotations/types'

function p(blockId: string, text: string): PMNode {
  return schema.node('paragraph', { blockId }, [schema.text(text)])
}

function docOf(...blocks: PMNode[]): PMNode {
  return schema.node('doc', null, blocks)
}

function mount(doc: PMNode): EditorView {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const state = EditorState.create({ schema, doc, plugins: [createProposedChangePlugin()] })
  const view: EditorView = new EditorView(host, {
    state,
    dispatchTransaction(transaction) {
      const newState = view.state.apply(transaction)
      view.updateState(newState)
    },
  })
  return view
}

function edit(overrides: Partial<ProposedEdit>): ProposedEdit {
  return {
    id: 'pe_1',
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

const views: EditorView[] = []
function tracked(view: EditorView): EditorView {
  views.push(view)
  return view
}

afterEach(() => {
  while (views.length) views.pop()!.destroy()
  vi.restoreAllMocks()
})

describe('setProposedEdits re-anchoring (drift fix)', () => {
  // doc: p1 "alpha beta gamma" (pos 0, content 1..16), p2 "delta beta omega"
  const doc = docOf(p('b1', 'alpha beta gamma'), p('b2', 'delta beta omega'))

  it('re-anchors stale from/to against the current doc via blockId', () => {
    const view = tracked(mount(doc))
    // "beta" in b2 actually sits at 24..28; the stored anchor is stale garbage.
    setProposedEdits(view, [edit({ id: 'pe_stale', from: 1, to: 5, targetText: 'beta', blockId: 'b2' })])
    const anchor = getProposedAnchors(view.state).get('pe_stale')
    expect(anchor).toBeDefined()
    expect(view.state.doc.textBetween(anchor!.from, anchor!.to)).toBe('beta')
    // blockId scoping picked the b2 occurrence, not the earlier b1 one.
    expect(anchor!.from).toBeGreaterThan(17)
  })

  it('falls back to a whole-doc fingerprint search when blockId is absent', () => {
    const view = tracked(mount(doc))
    setProposedEdits(view, [edit({ id: 'pe_nofid', from: 9, to: 12, targetText: 'gamma' })])
    const anchor = getProposedAnchors(view.state).get('pe_nofid')
    expect(anchor).toBeDefined()
    expect(view.state.doc.textBetween(anchor!.from, anchor!.to)).toBe('gamma')
  })

  it('drops edits whose target text no longer resolves, and warns with the count', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const view = tracked(mount(doc))
    setProposedEdits(view, [
      edit({ id: 'pe_ok', targetText: 'alpha', blockId: 'b1' }),
      edit({ id: 'pe_gone', targetText: 'vanished text' }),
    ])
    const anchors = getProposedAnchors(view.state)
    expect(anchors.has('pe_ok')).toBe(true)
    expect(anchors.has('pe_gone')).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped 1 proposed edit'))
  })

  it('keeps already-correct anchors as-is', () => {
    const view = tracked(mount(doc))
    // "alpha" in b1 is at 1..6.
    setProposedEdits(view, [edit({ id: 'pe_exact', from: 1, to: 6, targetText: 'alpha', blockId: 'b1' })])
    const anchor = getProposedAnchors(view.state).get('pe_exact')
    expect(anchor).toMatchObject({ from: 1, to: 6 })
  })

  it('passes insertions (empty targetText) through with stored positions', () => {
    const view = tracked(mount(doc))
    setProposedEdits(view, [edit({ id: 'pe_insert', from: 6, to: 6, targetText: '', newText: ' inserted' })])
    const anchor = getProposedAnchors(view.state).get('pe_insert')
    expect(anchor).toMatchObject({ from: 6, to: 6 })
  })
})
