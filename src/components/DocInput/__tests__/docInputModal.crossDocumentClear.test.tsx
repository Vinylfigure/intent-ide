// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { DocInputModal } from '@/components/DocInput/DocInputModal'
import { useEditorStore } from '@/stores/editorStore'
import { useDocumentStore } from '@/stores/documentStore'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useChangesStore } from '@/stores/changesStore'
import { schema } from '@/lib/prosemirror/schema'
import type { Annotation } from '@/lib/annotations/types'
import type { ChangeEntry, ChangeSet } from '@/lib/changes/changeLog'

function mountView(): EditorView {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const doc = schema.node('doc', null, [
    schema.node('paragraph', { blockId: 'b1' }, [schema.text('Existing content.')]),
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

function makeAnnotation(id: string, documentId: string): Annotation {
  return {
    id,
    documentId,
    locationGroupKey: `${documentId}:0:10`,
    type: 'ask',
    status: 'resolved',
    transcript: 'annotation',
    anchor: { from: 0, to: 10, scope: 'phrase', text: 'x' },
    resolution: null,
    conversation: [],
    parentId: null,
    childIds: [],
    createdAt: 0,
    resolvedAt: null,
    verbosity: 'normal',
  }
}

function makeChangeEntry(id: string, documentId: string): ChangeEntry {
  return {
    id,
    documentId,
    rootAnnotationId: null,
    annotationId: null,
    timestamp: 0,
    description: 'edit',
    beforeSlice: 'a',
    afterSlice: 'b',
    from: 0,
    to: 1,
    pmStep: null,
    undone: false,
  }
}

function makeChangeSet(id: string, documentId: string): ChangeSet {
  return {
    id,
    documentId,
    rootAnnotationId: 'ann-a',
    annotationIds: ['ann-a'],
    changeEntryIds: [],
    auditRecordIds: [],
    title: 'Thread',
    status: 'pending',
    updatedAt: 0,
  }
}

afterEach(() => {
  cleanup()
  const view = useEditorStore.getState().view as EditorView | null
  view?.destroy()
  useEditorStore.setState({ view: null })
  useDocumentStore.setState({ documents: [], collections: [], activeDocumentId: null })
  useAnnotationStore.setState({ annotations: [], activeAnnotationId: null })
  useChangesStore.setState({ entries: [], changeSets: [], snapshots: [] })
})

// Regression for #114: DocInputModal's loadDoc() (shared by Blank/Paste/
// Generate/Import) called the GLOBAL annotationStore.clear() /
// changesStore.clear() after creating a brand-new document — wiping every
// OTHER existing document's annotations and change history, not just
// resetting state for the new (empty) document.
describe('DocInputModal loadDoc() does not wipe other documents (#114)', () => {
  it('creating a blank document leaves an existing document\'s annotations and change history intact', () => {
    useDocumentStore.setState({ documents: [{ id: 'doc-a', title: 'Doc A', createdAt: 0, updatedAt: 0, collectionIds: [] }] })
    useAnnotationStore.setState({ annotations: [makeAnnotation('ann-a', 'doc-a')] })
    useChangesStore.setState({
      entries: [makeChangeEntry('entry-a', 'doc-a')],
      changeSets: [makeChangeSet('set-a', 'doc-a')],
      snapshots: [],
    })

    const view = mountView()
    useEditorStore.setState({ view })

    const { getByText } = render(<DocInputModal onClose={() => {}} />)
    fireEvent.click(getByText('Create Blank Document'))

    // A new document was created...
    expect(useDocumentStore.getState().documents).toHaveLength(2)

    // ...but Doc A's review history survives untouched.
    expect(useAnnotationStore.getState().annotations.map((a) => a.id)).toEqual(['ann-a'])
    expect(useChangesStore.getState().entries.map((e) => e.id)).toEqual(['entry-a'])
    expect(useChangesStore.getState().changeSets.map((c) => c.id)).toEqual(['set-a'])
  })
})
