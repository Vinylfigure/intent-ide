import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { Node } from 'prosemirror-model'
import { history, undo } from 'prosemirror-history'
import { schema } from '@/lib/prosemirror/schema'
import {
  createChangeTrackingPlugin,
  setChangeCallback,
} from '../plugins/changeTrackingPlugin'

function docWithText(text: string): Node {
  return Node.fromJSON(schema, {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })
}

describe('changeTrackingPlugin', () => {
  let calls: any[]

  beforeEach(() => {
    calls = []
    setChangeCallback((change) => calls.push(change))
  })

  afterEach(() => {
    setChangeCallback(() => {})
  })

  it('tracks a normal typing transaction', () => {
    const state = EditorState.create({
      schema,
      doc: docWithText('Hello'),
      plugins: [createChangeTrackingPlugin()],
    })

    const tr = state.tr.insertText(' world', state.doc.content.size - 1)
    state.apply(tr)

    expect(calls).toHaveLength(1)
    expect(calls[0].id).toBeTruthy()
    expect(calls[0].steps).toHaveLength(1)
  })

  it('skips state loads: a full-document replaceWith with addToHistory:false is not an edit', () => {
    // Restore and document-switch both dispatch this shape. Before the fix it
    // pushed a full-document beforeSlice/afterSlice "Direct edit" entry into
    // the persisted changes store on every restore/switch.
    const state = EditorState.create({
      schema,
      doc: docWithText('current document'),
      plugins: [createChangeTrackingPlugin()],
    })

    const restored = docWithText('restored snapshot')
    const tr = state.tr.replaceWith(0, state.doc.content.size, restored.content)
    tr.setMeta('addToHistory', false)
    const next = state.apply(tr)

    expect(next.doc.textContent).toBe('restored snapshot') // load happened…
    expect(calls).toHaveLength(0) // …but no phantom "Direct edit" was logged
  })

  it('still tracks ordinary edits made after a state load', () => {
    let state = EditorState.create({
      schema,
      doc: docWithText('current'),
      plugins: [createChangeTrackingPlugin()],
    })

    const loadTr = state.tr.replaceWith(0, state.doc.content.size, docWithText('loaded').content)
    loadTr.setMeta('addToHistory', false)
    state = state.apply(loadTr)
    expect(calls).toHaveLength(0)

    state = state.apply(state.tr.insertText('!', state.doc.content.size - 1))
    expect(calls).toHaveLength(1)
  })
})

describe('prosemirror-history after a restore-style state load', () => {
  it('undo immediately after a full-document replaceWith with addToHistory:false does not throw; the pre-load edit is no longer undoable', () => {
    // Documents the interaction between the undo stack and a restore:
    // the load transaction is excluded from history (addToHistory:false), so
    // prosemirror-history rebases the stored undo steps through the
    // full-document replace mapping. Because the replace covers the entire
    // document, the earlier typing step cannot be mapped back into the new
    // content — undo becomes a safe no-op rather than half-reverting the
    // restore or corrupting positions.
    let state = EditorState.create({
      schema,
      doc: docWithText('Hello'),
      plugins: [history(), createChangeTrackingPlugin()],
    })

    // An undoable edit…
    state = state.apply(state.tr.insertText(' world', state.doc.content.size - 1))
    expect(state.doc.textContent).toBe('Hello world')

    // …then a restore-style load, outside undo history.
    const loadTr = state.tr.replaceWith(0, state.doc.content.size, docWithText('restored').content)
    loadTr.setMeta('addToHistory', false)
    state = state.apply(loadTr)
    expect(state.doc.textContent).toBe('restored')

    // Cmd-Z straight after the restore: must not throw, must not resurrect
    // the pre-restore document.
    let dispatched = false
    expect(() =>
      undo(state, (tr) => {
        dispatched = true
        state = state.apply(tr)
      }),
    ).not.toThrow()

    expect(state.doc.textContent).toBe('restored')
    // Whether or not prosemirror-history dispatched a (mapped, contentless)
    // transaction, the visible document is unchanged.
    if (dispatched) {
      expect(state.doc.textContent).toBe('restored')
    }
  })
})
