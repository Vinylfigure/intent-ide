// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { DocumentHubSidebar } from '@/components/Layout/DocumentHubSidebar'
import { useDocumentStore, type CollectionMeta, type DocumentMeta } from '@/stores/documentStore'
import { useAnnotationStore } from '@/stores/annotationStore'

function makeDocument(id: string, title: string, collectionIds: string[] = []): DocumentMeta {
  return { id, title, createdAt: 0, updatedAt: 0, collectionIds }
}

function makeCollection(id: string, name: string): CollectionMeta {
  return { id, name, createdAt: 0, updatedAt: 0 }
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
})

// Regression for #115: the collection delete button went straight to
// deleteCollection with no confirmation step, unlike document delete (#110).
describe('DocumentHubSidebar delete-collection confirmation gate (#115)', () => {
  it('does not delete the collection until the user confirms', () => {
    useDocumentStore.setState({
      collections: [makeCollection('col-1', 'My Collection')],
      documents: [makeDocument('doc-1', 'Doc A', ['col-1']), makeDocument('doc-2', 'Doc B', ['col-1'])],
    })

    const { getByLabelText, container } = render(<DocumentHubSidebar />)

    fireEvent.click(getByLabelText('Delete collection'))

    // Still present — clicking the trash icon alone must not delete anything.
    expect(useDocumentStore.getState().collections).toHaveLength(1)
    expect(useDocumentStore.getState().documents[0].collectionIds).toEqual(['col-1'])

    // The gate names what will be lost.
    const description = container.querySelector('.confirmation-description')?.textContent ?? ''
    expect(description).toMatch(/My Collection/)
    expect(description).toMatch(/2 documents/)
  })

  it('deletes the collection and un-assigns its documents once confirmed', () => {
    useDocumentStore.setState({
      collections: [makeCollection('col-1', 'My Collection')],
      documents: [makeDocument('doc-1', 'Doc A', ['col-1'])],
    })

    const { getByLabelText, getByRole } = render(<DocumentHubSidebar />)

    fireEvent.click(getByLabelText('Delete collection'))
    fireEvent.click(getByRole('button', { name: 'Delete' }))

    expect(useDocumentStore.getState().collections).toHaveLength(0)
    // The document itself is not deleted — only un-assigned from the collection.
    expect(useDocumentStore.getState().documents).toHaveLength(1)
    expect(useDocumentStore.getState().documents[0].collectionIds).toEqual([])
  })

  it('leaves the collection untouched when cancelled', () => {
    useDocumentStore.setState({
      collections: [makeCollection('col-1', 'My Collection')],
      documents: [makeDocument('doc-1', 'Doc A', ['col-1'])],
    })

    const { getByLabelText, getByRole, queryByText } = render(<DocumentHubSidebar />)

    fireEvent.click(getByLabelText('Delete collection'))
    fireEvent.click(getByRole('button', { name: 'Cancel' }))

    expect(useDocumentStore.getState().collections).toHaveLength(1)
    expect(useDocumentStore.getState().documents[0].collectionIds).toEqual(['col-1'])
    expect(queryByText('Delete this collection?')).toBeFalsy()
  })

  it('does not mention a document count when the collection is empty', () => {
    useDocumentStore.setState({ collections: [makeCollection('col-1', 'Empty Collection')] })

    const { getByLabelText, container } = render(<DocumentHubSidebar />)

    fireEvent.click(getByLabelText('Delete collection'))

    const description = container.querySelector('.confirmation-description')?.textContent ?? ''
    expect(description).toMatch(/Empty Collection/)
    expect(description).not.toMatch(/document/)
  })
})
