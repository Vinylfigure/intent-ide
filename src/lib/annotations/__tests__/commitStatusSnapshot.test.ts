// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'
import {
  createProposedChangePlugin,
  setProposedEdits,
  setProposedEditStatus,
  getProposedAnchors,
} from '@/lib/prosemirror/plugins/proposedChangePlugin'
import { openCommitReview, restoreCommitReview } from '../commitStatusSnapshot'
import type { ProposedEdit } from '../types'

function p(blockId: string, text: string): PMNode {
  return schema.node('paragraph', { blockId }, [schema.text(text)])
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

// doc: b1 "alpha beta gamma" — "alpha" 1..6, "beta" 7..11, "gamma" 12..17.
const doc = schema.node('doc', null, [p('b1', 'alpha beta gamma')])

const edits: ProposedEdit[] = [
  edit({ id: 'pe_primary', from: 1, to: 6, targetText: 'alpha', relation: 'primary', severity: 'must', blockId: 'b1' }),
  edit({ id: 'pe_opt', from: 7, to: 11, targetText: 'beta', severity: 'optional', blockId: 'b1' }),
  edit({ id: 'pe_prob', from: 12, to: 17, targetText: 'gamma', severity: 'probably', blockId: 'b1' }),
]

const views: EditorView[] = []
function tracked(view: EditorView): EditorView {
  views.push(view)
  return view
}

afterEach(() => {
  while (views.length) views.pop()!.destroy()
})

describe('commit-modal status snapshot (MED fix: cancel must not leak toggles)', () => {
  it('open snapshots pre-open statuses and seeds optional pre-rejections into the plugin', () => {
    const view = tracked(mount(doc))
    setProposedEdits(view, edits)
    setProposedEditStatus(view, 'pe_prob', 'accepted')

    const snapshot = openCommitReview(view, edits)

    // Snapshot holds the statuses as they were BEFORE the open-time seeding.
    expect(snapshot).toEqual({
      pe_primary: 'pending',
      pe_opt: 'pending',
      pe_prob: 'accepted',
    })
    // The optional cascade's modal pre-rejection is now IN the plugin, so the
    // inline control and CascadeList agree with the modal immediately.
    const anchors = getProposedAnchors(view.state)
    expect(anchors.get('pe_opt')!.status).toBe('rejected')
    // Non-optional and explicitly-decided statuses are untouched.
    expect(anchors.get('pe_primary')!.status).toBe('pending')
    expect(anchors.get('pe_prob')!.status).toBe('accepted')
  })

  it('open → toggle reject → cancel: plugin statuses restored to the snapshot', () => {
    const view = tracked(mount(doc))
    setProposedEdits(view, edits)
    setProposedEditStatus(view, 'pe_prob', 'accepted')

    const snapshot = openCommitReview(view, edits)

    // User flips toggles in the modal (write-through to the plugin)...
    setProposedEditStatus(view, 'pe_prob', 'rejected')
    setProposedEditStatus(view, 'pe_primary', 'rejected')

    // ...then cancels. Everything goes back to the open-time snapshot,
    // including undoing the open-time optional pre-rejection.
    restoreCommitReview(view, snapshot)
    const anchors = getProposedAnchors(view.state)
    expect(anchors.get('pe_primary')!.status).toBe('pending')
    expect(anchors.get('pe_opt')!.status).toBe('pending')
    expect(anchors.get('pe_prob')!.status).toBe('accepted')
  })

  it('an optional cascade the user explicitly accepted inline is NOT pre-rejected at open', () => {
    const view = tracked(mount(doc))
    setProposedEdits(view, edits)
    setProposedEditStatus(view, 'pe_opt', 'accepted')

    openCommitReview(view, edits)
    expect(getProposedAnchors(view.state).get('pe_opt')!.status).toBe('accepted')
  })
})
