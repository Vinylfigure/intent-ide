// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { AnnotationPanel } from '@/components/Annotations/AnnotationPanel'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useDocumentStore } from '@/stores/documentStore'
import { useLayoutStore, ZERO_OFFSET } from '@/stores/layoutStore'
import type { Annotation } from '@/lib/annotations/types'

// End-to-end coverage for the "hide on finish" feature: hiding removes a
// card from AnnotationPanel's rendered list AND decrements the "N review
// items" header count; the "Show N resolved" toggle restores it; a
// pre-existing persisted annotation with no `hidden` field renders
// unconditionally (the upgrade case); a parent is never hidden while a
// visible child remains; and none of this ever calls `remove()` (hiding is
// not deletion — see annotationStore.hidden.test.ts for the store-level
// guard this also exercises).

function makeAnnotation(overrides: Partial<Annotation> & { id: string }): Annotation {
  return {
    documentId: 'doc-1',
    locationGroupKey: `doc-1:${overrides.id}`,
    type: 'ask',
    status: 'resolved',
    transcript: `transcript for ${overrides.id}`,
    anchor: { from: 0, to: 10, scope: 'phrase', text: 'anchor text' },
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
  useDocumentStore.setState({
    documents: [],
    collections: [],
    activeDocumentId: null,
    lastSavedAt: null,
    isDirty: false,
  })
  useAnnotationStore.setState({ annotations: [], activeAnnotationId: null })
  useLayoutStore.setState({ answerPlacement: 'sidebar', floatingOffset: ZERO_OFFSET, collapsedAnnotationIds: [] })
})

describe('AnnotationPanel — hidden-annotation filtering', () => {
  it('excludes a hidden (applied) annotation from the list and the header count', () => {
    useDocumentStore.setState({ activeDocumentId: 'doc-1' })
    useAnnotationStore.setState({
      annotations: [
        makeAnnotation({ id: 'open-1', status: 'resolved' }),
        makeAnnotation({ id: 'done-1', status: 'applied', hidden: true }),
      ],
    })

    const { getByText, queryByText } = render(<AnnotationPanel />)

    expect(getByText('1 review item')).toBeTruthy()
    expect(getByText('transcript for open-1')).toBeTruthy()
    expect(queryByText('transcript for done-1')).toBeNull()
  })

  it('excludes a hidden (dismissed) annotation the same way', () => {
    useDocumentStore.setState({ activeDocumentId: 'doc-1' })
    useAnnotationStore.setState({
      annotations: [makeAnnotation({ id: 'done-1', status: 'dismissed', hidden: true })],
    })

    const { queryByText, getByText } = render(<AnnotationPanel />)
    expect(queryByText('transcript for done-1')).toBeNull()
    // All annotations for the doc are hidden — the "all caught up" message
    // (not the generic "no annotations for this document" empty state, and
    // not a raw "0 review items" with an empty list) should appear, with a
    // way back via the toggle.
    expect(getByText(/all caught up/i)).toBeTruthy()
    expect(getByText(/show 1 resolved/i)).toBeTruthy()
  })

  it('the "Show N resolved" toggle restores hidden cards, and toggling again hides them', () => {
    useDocumentStore.setState({ activeDocumentId: 'doc-1' })
    useAnnotationStore.setState({
      annotations: [
        makeAnnotation({ id: 'open-1', status: 'resolved' }),
        makeAnnotation({ id: 'done-1', status: 'applied', hidden: true }),
      ],
    })

    const { getByText, queryByText, getByRole } = render(<AnnotationPanel />)
    expect(queryByText('transcript for done-1')).toBeNull()

    const toggle = getByRole('button', { name: /show 1 resolved/i })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(toggle)
    expect(getByText('transcript for done-1')).toBeTruthy()
    expect(getByText('2 review items')).toBeTruthy()
    expect(getByRole('button', { name: /hide resolved/i }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(getByRole('button', { name: /hide resolved/i }))
    expect(queryByText('transcript for done-1')).toBeNull()
    expect(getByText('1 review item')).toBeTruthy()
  })

  it('a revealed hidden card renders a visible muted "hidden" marker', () => {
    useDocumentStore.setState({ activeDocumentId: 'doc-1' })
    useAnnotationStore.setState({
      annotations: [makeAnnotation({ id: 'done-1', status: 'applied', hidden: true })],
    })

    const { getByRole, getByText } = render(<AnnotationPanel />)
    fireEvent.click(getByRole('button', { name: /show 1 resolved/i }))
    expect(getByText('hidden')).toBeTruthy()
  })

  it('renders a pre-existing annotation with no `hidden` field at all (the upgrade case)', () => {
    useDocumentStore.setState({ activeDocumentId: 'doc-1' })
    const legacy = makeAnnotation({ id: 'legacy-1', status: 'applied' })
    delete (legacy as Partial<Annotation>).hidden // simulate a snapshot from before this field existed
    useAnnotationStore.setState({ annotations: [legacy] })

    const { getByText, queryByText } = render(<AnnotationPanel />)
    expect(getByText('transcript for legacy-1')).toBeTruthy()
    expect(getByText('1 review item')).toBeTruthy()
    // No hidden marker, and no toggle — nothing is hidden.
    expect(queryByText(/show \d+ resolved/i)).toBeNull()
  })

  it('does not hide a parent while it still has a visible (non-hidden) child', () => {
    useDocumentStore.setState({ activeDocumentId: 'doc-1' })
    const parent = makeAnnotation({
      id: 'parent-1',
      status: 'applied',
      hidden: true,
      locationGroupKey: 'doc-1:shared',
      childIds: ['child-1'],
    })
    const child = makeAnnotation({
      id: 'child-1',
      status: 'resolved', // resolved is never hideable — still needs the user
      locationGroupKey: 'doc-1:shared',
      parentId: 'parent-1',
    })
    useAnnotationStore.setState({ annotations: [parent, child] })

    const { getByText } = render(<AnnotationPanel />)
    // Both render: hiding the root would orphan the still-visible child.
    expect(getByText('transcript for parent-1')).toBeTruthy()
    expect(getByText('transcript for child-1')).toBeTruthy()
    expect(getByText('2 review items')).toBeTruthy()
  })

  it('never calls remove() while hiding, revealing, or rendering', () => {
    useDocumentStore.setState({ activeDocumentId: 'doc-1' })
    useAnnotationStore.setState({
      annotations: [
        makeAnnotation({ id: 'open-1', status: 'resolved' }),
        makeAnnotation({ id: 'done-1', status: 'applied', hidden: true }),
      ],
    })
    const removeSpy = vi.spyOn(useAnnotationStore.getState(), 'remove')

    const { getByRole } = render(<AnnotationPanel />)
    fireEvent.click(getByRole('button', { name: /show 1 resolved/i }))
    fireEvent.click(getByRole('button', { name: /hide resolved/i }))

    expect(removeSpy).not.toHaveBeenCalled()
    expect(useAnnotationStore.getState().annotations).toHaveLength(2)
    removeSpy.mockRestore()
  })
})
