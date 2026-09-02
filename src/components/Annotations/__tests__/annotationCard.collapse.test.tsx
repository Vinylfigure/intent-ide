// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { AnnotationCard } from '@/components/Annotations/AnnotationCard'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useLayoutStore, ZERO_OFFSET } from '@/stores/layoutStore'
import type { Annotation } from '@/lib/annotations/types'

// Per-card collapse: a chevron toggle that collapses AnnotationCard to its
// header line, backed by layoutStore.collapsedAnnotationIds (a view
// preference, not annotation state — see layoutStore.collapsedAnnotations.test.ts
// for the store-level coverage of persistence/normalization).

function makeAnnotation(overrides: Partial<Annotation> & { id: string }): Annotation {
  return {
    documentId: 'doc-1',
    locationGroupKey: 'doc-1:0:10',
    type: 'ask',
    status: 'resolved',
    transcript: 'Should this collapse?',
    anchor: { from: 0, to: 10, scope: 'phrase', text: 'anchor text for the card' },
    resolution: null,
    conversation: [],
    parentId: null,
    childIds: [],
    createdAt: 0,
    resolvedAt: null,
    verbosity: 'normal',
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  useAnnotationStore.setState({ annotations: [], activeAnnotationId: null })
  useLayoutStore.setState({ answerPlacement: 'sidebar', floatingOffset: ZERO_OFFSET, collapsedAnnotationIds: [] })
})

describe('AnnotationCard — collapse', () => {
  it('is expanded by default: the transcript and anchor are visible, aria-expanded is true', () => {
    const annotation = makeAnnotation({ id: 'ann-1' })
    useAnnotationStore.setState({ annotations: [annotation] })

    const { getByText, getByRole } = render(<AnnotationCard annotation={annotation} isActive={false} />)
    expect(getByText('Should this collapse?')).toBeTruthy()
    const chevron = getByRole('button', { name: /collapse annotation/i })
    expect(chevron.getAttribute('aria-expanded')).toBe('true')
  })

  it('clicking the chevron collapses the card to its header line and flips aria-expanded', () => {
    const annotation = makeAnnotation({ id: 'ann-1' })
    useAnnotationStore.setState({ annotations: [annotation] })

    const { getByText, queryByText, getByRole } = render(<AnnotationCard annotation={annotation} isActive={false} />)
    fireEvent.click(getByRole('button', { name: /collapse annotation/i }))

    expect(queryByText('Should this collapse?')).toBeNull()
    const chevron = getByRole('button', { name: /expand annotation/i })
    expect(chevron.getAttribute('aria-expanded')).toBe('false')
    // The type badge (header) stays visible even when collapsed.
    expect(getByText('Ask')).toBeTruthy()
  })

  it('clicking the chevron again re-expands the card', () => {
    const annotation = makeAnnotation({ id: 'ann-1' })
    useAnnotationStore.setState({ annotations: [annotation] })

    const { getByText, getByRole } = render(<AnnotationCard annotation={annotation} isActive={false} />)
    fireEvent.click(getByRole('button', { name: /collapse annotation/i }))
    fireEvent.click(getByRole('button', { name: /expand annotation/i }))

    expect(getByText('Should this collapse?')).toBeTruthy()
    expect(getByRole('button', { name: /collapse annotation/i }).getAttribute('aria-expanded')).toBe('true')
  })

  it('collapsing does not activate/deactivate the card (event does not bubble to the card click handler)', () => {
    const annotation = makeAnnotation({ id: 'ann-1' })
    useAnnotationStore.setState({ annotations: [annotation] })

    const { getByRole } = render(<AnnotationCard annotation={annotation} isActive={false} />)
    fireEvent.click(getByRole('button', { name: /collapse annotation/i }))

    expect(useAnnotationStore.getState().activeAnnotationId).toBeNull()
  })

  it('persists the collapsed state in layoutStore, keyed by annotation id', () => {
    const annotation = makeAnnotation({ id: 'ann-1' })
    useAnnotationStore.setState({ annotations: [annotation] })

    const { getByRole } = render(<AnnotationCard annotation={annotation} isActive={false} />)
    fireEvent.click(getByRole('button', { name: /collapse annotation/i }))

    expect(useLayoutStore.getState().collapsedAnnotationIds).toEqual(['ann-1'])
  })
})
