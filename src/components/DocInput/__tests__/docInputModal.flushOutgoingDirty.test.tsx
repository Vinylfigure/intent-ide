// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { DocInputModal } from '@/components/DocInput/DocInputModal'
import { useEditorStore } from '@/stores/editorStore'
import { useDocumentStore } from '@/stores/documentStore'
import { schema } from '@/lib/prosemirror/schema'

function mountView(): EditorView {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const doc = schema.node('doc', null, [
    schema.node('paragraph', { blockId: 'b1' }, [schema.text('Original content.')]),
  ])
  const state = EditorState.create({ schema, doc })
  const view: EditorView = new EditorView(host, {
    state,
    dispatchTransaction(transaction) {
      view.updateState(view.state.apply(transaction))
    },
  })
  return view
}

afterEach(() => {
  cleanup()
  const view = useEditorStore.getState().view as EditorView | null
  view?.destroy()
  useEditorStore.setState({ view: null })
  useDocumentStore.setState({ documents: [], collections: [], activeDocumentId: null, isDirty: false })
  localStorage.removeItem('intent-ide-doc:doc-a')
})

// Regression for #122: DocInputModal's loadDoc() (shared by Blank/Paste/
// Generate/Import) replaced the editor's content and switched
// activeDocumentId WITHOUT flushing the outgoing document's dirty state
// first — unlike EditorShell.tsx's own document-switch effect, which already
// guards against exactly this. An edit made to the previous document within
// the 5s autosave window was silently dropped (never written to
// localStorage, never recorded via recordCommit) rather than persisted.
describe('DocInputModal loadDoc() flushes the outgoing document before switching (#122)', () => {
  it('persists Document A\'s dirty edit before creating Document B via the Blank flow', () => {
    useDocumentStore.setState({
      documents: [{ id: 'doc-a', title: 'Doc A', createdAt: 0, updatedAt: 0, collectionIds: [] }],
      activeDocumentId: 'doc-a',
      isDirty: false,
    })

    const view = mountView()
    useEditorStore.setState({ view })

    // Simulate an unsaved edit to Doc A: the live editor content diverges
    // from what's persisted, and isDirty is true (as EditorShell's
    // debouncedSave would set it), but the 5s autosave timer hasn't fired.
    const editedDoc = schema.node('doc', null, [
      schema.node('paragraph', { blockId: 'b1' }, [schema.text('Original content. Edited by the user.')]),
    ])
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, editedDoc.content))
    useDocumentStore.getState().setDirty(true)

    // Before the fix, Doc A's persisted JSON is still the pre-edit content —
    // saveDocument was never called for it.
    expect(useDocumentStore.getState().loadDocumentJson('doc-a')).toBeNull()

    const { getByText } = render(<DocInputModal onClose={() => {}} />)
    fireEvent.click(getByText('Create Blank Document'))

    // A second document was created and is now active...
    const docs = useDocumentStore.getState().documents
    expect(docs).toHaveLength(2)
    expect(useDocumentStore.getState().activeDocumentId).not.toBe('doc-a')

    // ...but Doc A's edit was flushed to the store before the switch, not
    // silently dropped.
    const persistedDocA = useDocumentStore.getState().loadDocumentJson('doc-a')
    expect(persistedDocA).not.toBeNull()
    expect(JSON.stringify(persistedDocA)).toContain('Edited by the user.')
  })

  it('does not attempt a flush when the outgoing document is not dirty', () => {
    useDocumentStore.setState({
      documents: [{ id: 'doc-a', title: 'Doc A', createdAt: 0, updatedAt: 0, collectionIds: [] }],
      activeDocumentId: 'doc-a',
      isDirty: false,
    })

    const view = mountView()
    useEditorStore.setState({ view })

    const { getByText } = render(<DocInputModal onClose={() => {}} />)
    fireEvent.click(getByText('Create Blank Document'))

    // Nothing to flush: Doc A was never persisted, and this test only
    // asserts the flush path doesn't throw or otherwise misbehave when
    // isDirty is false (the common, non-buggy case).
    expect(useDocumentStore.getState().documents).toHaveLength(2)
  })
})
