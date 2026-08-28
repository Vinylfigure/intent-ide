// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { history, undo } from 'prosemirror-history'
import { DocInputModal } from '@/components/DocInput/DocInputModal'
import { useEditorStore } from '@/stores/editorStore'
import { useDocumentStore } from '@/stores/documentStore'
import { schema } from '@/lib/prosemirror/schema'

function mountViewWithHistory(initialText: string): EditorView {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const doc = schema.node('doc', null, [
    schema.node('paragraph', { blockId: 'b1' }, [schema.text(initialText)]),
  ])
  const state = EditorState.create({ schema, doc, plugins: [history()] })
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
  useDocumentStore.setState({ documents: [], collections: [], activeDocumentId: null })
})

// Regression for #117: DocInputModal's loadDoc() replaced the editor's
// content without tr.setMeta('addToHistory', false), so the load landed in
// the undo stack. Cmd-Z immediately after creating/pasting a new document
// could resurrect the PREVIOUS document's content while activeDocumentId
// already pointed at the new one — the same failure class EditorShell's
// document-switch guard exists to prevent.
describe('DocInputModal loadDoc() is not undoable (#117)', () => {
  it('pressing undo after loading a pasted document does not resurrect the prior content', () => {
    const view = mountViewWithHistory('Old document that must never come back.')
    useEditorStore.setState({ view })

    const { getByPlaceholderText, getByText, getByRole } = render(<DocInputModal onClose={() => {}} />)

    fireEvent.click(getByText('Paste'))
    fireEvent.change(getByPlaceholderText('Paste your document here... (supports markdown)'), {
      target: { value: 'New pasted content.' },
    })
    fireEvent.click(getByRole('button', { name: 'Load Document' }))

    expect(view.state.doc.textContent).toBe('New pasted content.')

    const undone = undo(view.state, view.dispatch)

    // Either undo reports nothing to undo, or it ran and left the loaded
    // content untouched — either way the prior document must not reappear.
    expect(view.state.doc.textContent).toBe('New pasted content.')
    expect(undone).toBe(false)
  })
})
