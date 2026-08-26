// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, fireEvent, cleanup, within } from '@testing-library/react'
import { DocumentHubSidebar } from '@/components/Layout/DocumentHubSidebar'
import { useDocumentStore, type DocumentMeta } from '@/stores/documentStore'
import { useAnnotationStore } from '@/stores/annotationStore'
import type { Annotation } from '@/lib/annotations/types'

function makeDocument(id: string, title: string): DocumentMeta {
  return { id, title, createdAt: 0, updatedAt: 0, collectionIds: [] }
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

// Regression for #110: both onDelete call sites went straight to
// handleDeleteDocument with no confirmation step, and since #109 that also
// silently purges every annotation for the document in the same click.
describe('DocumentHubSidebar delete confirmation gate (#110)', () => {
  it('does not delete the document or its annotations until the user confirms', () => {
    useDocumentStore.setState({ documents: [makeDocument('doc-1', 'My Document')] })
    useAnnotationStore.setState({
      annotations: [makeAnnotation('ann-1', 'doc-1'), makeAnnotation('ann-2', 'doc-1')],
    })

    const { getByLabelText, container } = render(<DocumentHubSidebar />)

    fireEvent.click(getByLabelText('Delete document'))

    // Still present — clicking the trash icon alone must not delete anything.
    expect(useDocumentStore.getState().documents).toHaveLength(1)
    expect(useAnnotationStore.getState().annotations).toHaveLength(2)

    // The gate names what will be lost.
    const description = container.querySelector('.confirmation-description')?.textContent ?? ''
    expect(description).toMatch(/My Document/)
    expect(description).toMatch(/2 annotations/)
  })

  it('deletes the document and purges its annotations once confirmed', () => {
    useDocumentStore.setState({ documents: [makeDocument('doc-1', 'My Document')] })
    useAnnotationStore.setState({
      annotations: [makeAnnotation('ann-1', 'doc-1'), makeAnnotation('ann-2', 'doc-2')],
    })

    const { getByLabelText, getByRole } = render(<DocumentHubSidebar />)

    fireEvent.click(getByLabelText('Delete document'))
    fireEvent.click(getByRole('button', { name: 'Delete' }))

    expect(useDocumentStore.getState().documents).toHaveLength(0)
    expect(useAnnotationStore.getState().annotations.map((a) => a.id)).toEqual(['ann-2'])
  })

  it('leaves the document and its annotations untouched when cancelled', () => {
    useDocumentStore.setState({ documents: [makeDocument('doc-1', 'My Document')] })
    useAnnotationStore.setState({ annotations: [makeAnnotation('ann-1', 'doc-1')] })

    const { getByLabelText, getByRole, queryByText } = render(<DocumentHubSidebar />)

    fireEvent.click(getByLabelText('Delete document'))
    fireEvent.click(getByRole('button', { name: 'Cancel' }))

    expect(useDocumentStore.getState().documents).toHaveLength(1)
    expect(useAnnotationStore.getState().annotations).toHaveLength(1)
    expect(queryByText('Delete this document?')).toBeFalsy()
  })

  it('does not mention an annotation count when the document has none', () => {
    useDocumentStore.setState({ documents: [makeDocument('doc-1', 'Empty Doc')] })
    useAnnotationStore.setState({ annotations: [] })

    const { getByLabelText, container } = render(<DocumentHubSidebar />)

    fireEvent.click(getByLabelText('Delete document'))

    const description = container.querySelector('.confirmation-description')?.textContent ?? ''
    expect(description).toMatch(/Empty Doc/)
    expect(description).not.toMatch(/annotation/)
  })
})
