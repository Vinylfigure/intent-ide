// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '../schema'
import {
  createProposedChangePlugin,
  setProposedEdits,
  setProposedEditStatus,
  revealProposedEdits,
  getProposedAnchors,
} from '../plugins/proposedChangePlugin'
import { createReadLinePlugin, readLinePluginKey, type ReadLineMeta } from '../plugins/readLinePlugin'
import { applyProposedEdits } from '../applyProposedEdits'
import { pollCascadeReveal } from '@/lib/annotations/cascadeReveal'
import type { ProposedEdit } from '@/lib/annotations/types'

function p(blockId: string, text: string): PMNode {
  return schema.node('paragraph', { blockId }, [schema.text(text)])
}

// b1 content 1..17 (block content end 17), b2 19..35, b3 37..53.
function makeDoc(): PMNode {
  return schema.node('doc', null, [
    p('b1', 'alpha beta gamma'),
    p('b2', 'delta beta omega'),
    p('b3', 'omega tail block'),
  ])
}

function mount(doc: PMNode): EditorView {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const state = EditorState.create({
    schema,
    doc,
    plugins: [createProposedChangePlugin(), createReadLinePlugin()],
  })
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

// "alpha" in b1 at 1..6; "tail" in b3 at 43..47.
const primaryEdit = () =>
  edit({ id: 'pe_p', from: 1, to: 6, targetText: 'alpha', newText: 'ALPHA', relation: 'primary', blockId: 'b1', severity: 'must' })
const cascadeEdit = () =>
  edit({ id: 'pe_c', from: 43, to: 47, targetText: 'tail', newText: 'TAIL', blockId: 'b3' })

function markRead(view: EditorView, pos: number) {
  view.dispatch(
    view.state.tr.setMeta(readLinePluginKey, { markRead: pos } as ReadLineMeta),
  )
}

const views: EditorView[] = []
function tracked(view: EditorView): EditorView {
  views.push(view)
  return view
}

afterEach(() => {
  while (views.length) views.pop()!.destroy()
})

describe('flow-state holds as reveal flags (HIGH-1 redesign)', () => {
  it('held anchors render no decoration and no margin flag, but ARE in getProposedAnchors', () => {
    const view = tracked(mount(makeDoc()))
    markRead(view, 5) // reading tracked, hold engaged for below-read-line cascades
    setProposedEdits(view, [primaryEdit(), cascadeEdit()], ['pe_c'])

    const anchors = getProposedAnchors(view.state)
    expect(anchors.get('pe_c')).toBeDefined()
    expect(anchors.get('pe_c')!.revealed).toBe(false)
    expect(anchors.get('pe_p')!.revealed).toBe(true)

    // Primary is decorated; the held cascade renders nothing at all.
    expect(view.dom.querySelectorAll('[data-proposed-edit-id="pe_p"]').length).toBeGreaterThan(0)
    expect(view.dom.querySelectorAll('[data-proposed-edit-id="pe_c"]').length).toBe(0)
  })

  it('apply succeeds while a cascade is held (modal-accept path, HIGH-1 regression)', () => {
    const view = tracked(mount(makeDoc()))
    markRead(view, 5)
    setProposedEdits(view, [primaryEdit(), cascadeEdit()], ['pe_c'])

    // The modal shows every edit regardless of reveal state; the user accepts
    // both. The held anchor must still be a valid apply target.
    const result = applyProposedEdits(view, ['pe_p', 'pe_c'])
    expect(result.ok).toBe(true)
    const text = view.state.doc.textContent
    expect(text).toContain('ALPHA')
    expect(text).toContain('TAIL')
    expect(text).not.toContain('alpha')
    expect(text).not.toContain('tail')
  })

  it('reveal preserves prior accepted/rejected statuses (MED-3 regression)', () => {
    const view = tracked(mount(makeDoc()))
    markRead(view, 5)
    const cascadeB2 = edit({ id: 'pe_c2', from: 25, to: 29, targetText: 'beta', blockId: 'b2' })
    setProposedEdits(view, [primaryEdit(), cascadeEdit(), cascadeB2], ['pe_c', 'pe_c2'])

    // In-progress review decisions on revealed AND held anchors...
    setProposedEditStatus(view, 'pe_p', 'accepted')
    setProposedEditStatus(view, 'pe_c', 'rejected')

    // ...survive the reveal untouched.
    revealProposedEdits(view, ['pe_c', 'pe_c2'])
    const anchors = getProposedAnchors(view.state)
    expect(anchors.get('pe_p')!.status).toBe('accepted')
    expect(anchors.get('pe_c')!.status).toBe('rejected')
    expect(anchors.get('pe_c')!.revealed).toBe(true)
    expect(anchors.get('pe_c2')!.status).toBe('pending')
    expect(anchors.get('pe_c2')!.revealed).toBe(true)
  })

  it('pollCascadeReveal partitions on LIVE positions: typing during the hold shifts the breakpoint', () => {
    const view = tracked(mount(makeDoc()))
    markRead(view, 5)
    setProposedEdits(view, [primaryEdit(), cascadeEdit()], ['pe_c'])

    // User types 10 chars at the START of the primary block during the hold —
    // the block's content end (the breakpoint) moves 17 → 27.
    view.dispatch(view.state.tr.insertText('0123456789', 1))

    // Read-line reaches the OLD breakpoint (17). Stale stored positions would
    // reveal here; the live breakpoint is 27, so the cascade must stay held.
    markRead(view, 17)
    expect(pollCascadeReveal(view.state)).toEqual([])

    // Crossing the LIVE breakpoint reveals it.
    markRead(view, 27)
    expect(pollCascadeReveal(view.state)).toEqual(['pe_c'])
    revealProposedEdits(view, ['pe_c'])
    expect(getProposedAnchors(view.state).get('pe_c')!.revealed).toBe(true)
    expect(pollCascadeReveal(view.state)).toEqual([])
  })

  it('reading past the primary block end (the breakpoint) reveals held cascades', () => {
    const view = tracked(mount(makeDoc()))
    markRead(view, 5)
    setProposedEdits(view, [primaryEdit(), cascadeEdit()], ['pe_c'])

    // b1's content end is 17; the read line crossing it releases the hold.
    markRead(view, 20)
    expect(pollCascadeReveal(view.state)).toEqual(['pe_c'])
  })
})
