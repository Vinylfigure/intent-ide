// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { StatusBar } from '@/components/Layout/StatusBar'
import { useDocumentStore } from '@/stores/documentStore'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useChangesStore } from '@/stores/changesStore'
import type { Annotation } from '@/lib/annotations/types'
import type { ChangeEntry, ChangeSet } from '@/lib/changes/changeLog'

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

function makeEntry(id: string, documentId: string): ChangeEntry {
  return {
    id,
    documentId,
    rootAnnotationId: null,
    annotationId: null,
    timestamp: 0,
    description: 'change',
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
    rootAnnotationId: 'ann-1',
    annotationIds: [],
    changeEntryIds: [],
    auditRecordIds: [],
    title: 'set',
    status: 'pending',
    updatedAt: 0,
  }
}

afterEach(() => {
  cleanup()
  useDocumentStore.setState({
    documents: [],
    collections: [],
    activeDocumentId: null,
    lastSavedAt: null,
    isDirty: false,
  })
  useAnnotationStore.setState({ annotations: [], activeAnnotationId: null })
  useChangesStore.setState({ entries: [], changeSets: [], snapshots: [] })
})

// Regression for #116: the status bar chips read raw, unfiltered store
// totals instead of scoping to the active document like AnnotationPanel /
// ChangesPanel already do.
describe('StatusBar active-document scoping (#116)', () => {
  it('shows only the active document counts, not every document combined', () => {
    useDocumentStore.setState({ activeDocumentId: 'doc-1' })
    useAnnotationStore.setState({
      annotations: [
        makeAnnotation('ann-1', 'doc-1'),
        makeAnnotation('ann-2', 'doc-2'),
        makeAnnotation('ann-3', 'doc-2'),
      ],
    })
    useChangesStore.setState({
      entries: [makeEntry('c-1', 'doc-1'), makeEntry('c-2', 'doc-2')],
      changeSets: [makeChangeSet('cs-1', 'doc-1'), makeChangeSet('cs-2', 'doc-2')],
    })

    const { getByText } = render(<StatusBar />)

    expect(getByText('1 annotations')).toBeTruthy()
    expect(getByText('1 change sets')).toBeTruthy()
    expect(getByText('1 changes')).toBeTruthy()
  })

  it('updates the displayed counts when the active document changes', () => {
    useDocumentStore.setState({ activeDocumentId: 'doc-1' })
    useAnnotationStore.setState({
      annotations: [
        makeAnnotation('ann-1', 'doc-1'),
        makeAnnotation('ann-2', 'doc-1'),
        makeAnnotation('ann-3', 'doc-2'),
      ],
    })

    const { getByText, rerender } = render(<StatusBar />)
    expect(getByText('2 annotations')).toBeTruthy()

    useDocumentStore.setState({ activeDocumentId: 'doc-2' })
    rerender(<StatusBar />)

    expect(getByText('1 annotations')).toBeTruthy()
  })

  it('shows zero counts when no document is active', () => {
    useDocumentStore.setState({ activeDocumentId: null })
    useAnnotationStore.setState({ annotations: [makeAnnotation('ann-1', 'doc-1')] })
    useChangesStore.setState({
      entries: [makeEntry('c-1', 'doc-1')],
      changeSets: [makeChangeSet('cs-1', 'doc-1')],
    })

    const { getByText } = render(<StatusBar />)

    expect(getByText('0 annotations')).toBeTruthy()
    expect(getByText('0 change sets')).toBeTruthy()
    expect(getByText('0 changes')).toBeTruthy()
  })
})
