// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { DocumentHubSidebar } from '@/components/Layout/DocumentHubSidebar'
import { useDocumentStore, type DocumentMeta } from '@/stores/documentStore'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useChangesStore } from '@/stores/changesStore'
import type { ChangeEntry, ChangeSet } from '@/lib/changes/changeLog'

function makeDocument(id: string, title: string): DocumentMeta {
  return { id, title, createdAt: 0, updatedAt: 0, collectionIds: [] }
}

function makeEntry(id: string, documentId: string): ChangeEntry {
  return {
    id,
    documentId,
    rootAnnotationId: null,
    annotationId: null,
    timestamp: 0,
    description: 'edit',
    beforeSlice: 'before',
    afterSlice: 'after',
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
    rootAnnotationId: `root-${id}`,
    annotationIds: [`root-${id}`],
    changeEntryIds: [],
    auditRecordIds: [],
    title: 'Untitled review thread',
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

// Regression for #134: handleDeleteDocument purged annotationStore (#107)
// but never called changesStore's equivalent removeByDocumentId (#133) — a
// deleted document's changesStore entries/changeSets were silently orphaned
// forever, invisible to every documentId-filtered view but never removed.
describe('DocumentHubSidebar delete clears changesStore entries/changeSets (#134)', () => {
  it('removes the deleted document\'s change entries and change sets, leaving other documents untouched', () => {
    useDocumentStore.setState({ documents: [makeDocument('doc-1', 'My Document')] })
    useChangesStore.setState({
      entries: [makeEntry('e-1', 'doc-1'), makeEntry('e-2', 'doc-2')],
      changeSets: [makeChangeSet('cs-1', 'doc-1'), makeChangeSet('cs-2', 'doc-2')],
    })

    const { getByLabelText, getByRole } = render(<DocumentHubSidebar />)

    fireEvent.click(getByLabelText('Delete document'))
    fireEvent.click(getByRole('button', { name: 'Delete' }))

    expect(useDocumentStore.getState().documents).toHaveLength(0)
    expect(useChangesStore.getState().entries.map((e) => e.id)).toEqual(['e-2'])
    expect(useChangesStore.getState().changeSets.map((cs) => cs.id)).toEqual(['cs-2'])
  })

  it('leaves changesStore untouched when the delete is cancelled', () => {
    useDocumentStore.setState({ documents: [makeDocument('doc-1', 'My Document')] })
    useChangesStore.setState({
      entries: [makeEntry('e-1', 'doc-1')],
      changeSets: [makeChangeSet('cs-1', 'doc-1')],
    })

    const { getByLabelText, getByRole } = render(<DocumentHubSidebar />)

    fireEvent.click(getByLabelText('Delete document'))
    fireEvent.click(getByRole('button', { name: 'Cancel' }))

    expect(useDocumentStore.getState().documents).toHaveLength(1)
    expect(useChangesStore.getState().entries).toHaveLength(1)
    expect(useChangesStore.getState().changeSets).toHaveLength(1)
  })
})
