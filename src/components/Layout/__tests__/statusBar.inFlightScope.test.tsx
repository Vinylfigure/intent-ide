// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { StatusBar } from '@/components/Layout/StatusBar'
import { useDocumentStore } from '@/stores/documentStore'
import { useAnnotationStore } from '@/stores/annotationStore'
import type { Annotation, AnnotationStatus } from '@/lib/annotations/types'

function makeAnnotation(id: string, documentId: string, status: AnnotationStatus): Annotation {
  return {
    id,
    documentId,
    locationGroupKey: `${documentId}:0:10`,
    type: 'ask',
    status,
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

// Regression for #121: the "N thinking…" chip counted in-flight annotations
// across every document instead of scoping to the active document like the
// other three StatusBar chips (#116/#120).
describe('StatusBar in-flight chip scoping (#121)', () => {
  it('only counts the active document\'s in-flight annotations', () => {
    useDocumentStore.setState({ activeDocumentId: 'doc-1' })
    useAnnotationStore.setState({
      annotations: [
        makeAnnotation('ann-1', 'doc-1', 'resolving'),
        makeAnnotation('ann-2', 'doc-2', 'pending'),
        makeAnnotation('ann-3', 'doc-2', 'classified'),
      ],
    })

    const { getByText } = render(<StatusBar />)

    expect(getByText('1 thinking…')).toBeTruthy()
  })

  it('updates the count when the active document changes', () => {
    useDocumentStore.setState({ activeDocumentId: 'doc-1' })
    useAnnotationStore.setState({
      annotations: [
        makeAnnotation('ann-1', 'doc-1', 'pending'),
        makeAnnotation('ann-2', 'doc-1', 'classified'),
        makeAnnotation('ann-3', 'doc-2', 'resolving'),
      ],
    })

    const { getByText, queryByText, rerender } = render(<StatusBar />)
    expect(getByText('2 thinking…')).toBeTruthy()

    useDocumentStore.setState({ activeDocumentId: 'doc-2' })
    rerender(<StatusBar />)

    expect(getByText('1 thinking…')).toBeTruthy()
    expect(queryByText('2 thinking…')).toBeNull()
  })

  it('shows no chip when only other documents have in-flight annotations', () => {
    useDocumentStore.setState({ activeDocumentId: 'doc-1' })
    useAnnotationStore.setState({
      annotations: [makeAnnotation('ann-1', 'doc-2', 'resolving')],
    })

    const { queryByText } = render(<StatusBar />)

    expect(queryByText(/thinking…/)).toBeNull()
  })

  it('shows no chip when no document is active, even with in-flight annotations', () => {
    useDocumentStore.setState({ activeDocumentId: null })
    useAnnotationStore.setState({
      annotations: [makeAnnotation('ann-1', 'doc-1', 'pending')],
    })

    const { queryByText } = render(<StatusBar />)

    expect(queryByText(/thinking…/)).toBeNull()
  })
})
