import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAnnotationStore, canHideAnnotation, migrateAnnotations } from '@/stores/annotationStore'
import type { Annotation, AnnotationStatus } from '@/lib/annotations/types'

// Covers the "hide on finish" mechanism (L-shaped feature: `hidden` field +
// `setHidden` store action). AnnotationPanel's filtering is covered
// separately in annotationPanel.visibility.pure.test.ts (the pure
// computeVisibleAnnotationIds helper) and annotationPanel.hidden.test.tsx
// (end-to-end render).

function makeAnnotation(overrides: Partial<Annotation> & { id: string; status: AnnotationStatus }): Annotation {
  return {
    documentId: 'doc-1',
    locationGroupKey: 'doc-1:0:10',
    type: 'ask',
    transcript: 'test transcript',
    anchor: { from: 0, to: 10, scope: 'phrase', text: 'test' },
    resolution: null,
    conversation: [],
    parentId: null,
    childIds: [],
    createdAt: 1000,
    resolvedAt: null,
    verbosity: 'normal',
    ...overrides,
  }
}

beforeEach(() => {
  useAnnotationStore.setState({ annotations: [], activeAnnotationId: null })
})

describe('canHideAnnotation', () => {
  it('is true for terminal statuses (applied, dismissed)', () => {
    expect(canHideAnnotation({ status: 'applied' })).toBe(true)
    expect(canHideAnnotation({ status: 'dismissed' })).toBe(true)
  })

  it('is false for every non-terminal status', () => {
    expect(canHideAnnotation({ status: 'pending' })).toBe(false)
    expect(canHideAnnotation({ status: 'classified' })).toBe(false)
    expect(canHideAnnotation({ status: 'resolving' })).toBe(false)
    expect(canHideAnnotation({ status: 'resolved' })).toBe(false)
  })
})

describe('useAnnotationStore.setHidden', () => {
  it('hides an applied annotation', () => {
    useAnnotationStore.setState({ annotations: [makeAnnotation({ id: 'a1', status: 'applied' })] })
    useAnnotationStore.getState().setHidden('a1', true)
    expect(useAnnotationStore.getState().getById('a1')?.hidden).toBe(true)
  })

  it('hides a dismissed annotation', () => {
    useAnnotationStore.setState({ annotations: [makeAnnotation({ id: 'a1', status: 'dismissed' })] })
    useAnnotationStore.getState().setHidden('a1', true)
    expect(useAnnotationStore.getState().getById('a1')?.hidden).toBe(true)
  })

  it('refuses to hide a resolved annotation — it still has actions the user has not taken', () => {
    useAnnotationStore.setState({ annotations: [makeAnnotation({ id: 'a1', status: 'resolved' })] })
    useAnnotationStore.getState().setHidden('a1', true)
    expect(useAnnotationStore.getState().getById('a1')?.hidden).toBeUndefined()
  })

  it('refuses to hide a pending/resolving annotation', () => {
    useAnnotationStore.setState({
      annotations: [
        makeAnnotation({ id: 'a1', status: 'pending' }),
        makeAnnotation({ id: 'a2', status: 'resolving' }),
      ],
    })
    useAnnotationStore.getState().setHidden('a1', true)
    useAnnotationStore.getState().setHidden('a2', true)
    expect(useAnnotationStore.getState().getById('a1')?.hidden).toBeUndefined()
    expect(useAnnotationStore.getState().getById('a2')?.hidden).toBeUndefined()
  })

  it('always allows unhiding, regardless of status', () => {
    useAnnotationStore.setState({
      annotations: [makeAnnotation({ id: 'a1', status: 'applied', hidden: true })],
    })
    useAnnotationStore.getState().setHidden('a1', false)
    expect(useAnnotationStore.getState().getById('a1')?.hidden).toBe(false)
  })

  it('is a no-op for an unknown id', () => {
    useAnnotationStore.setState({ annotations: [makeAnnotation({ id: 'a1', status: 'applied' })] })
    useAnnotationStore.getState().setHidden('does-not-exist', true)
    expect(useAnnotationStore.getState().annotations).toHaveLength(1)
    expect(useAnnotationStore.getState().getById('a1')?.hidden).toBeUndefined()
  })

  it('never removes the annotation — hiding is not deletion', () => {
    const removeSpy = vi.spyOn(useAnnotationStore.getState(), 'remove')
    useAnnotationStore.setState({ annotations: [makeAnnotation({ id: 'a1', status: 'applied' })] })
    useAnnotationStore.getState().setHidden('a1', true)
    expect(removeSpy).not.toHaveBeenCalled()
    expect(useAnnotationStore.getState().annotations).toHaveLength(1)
    removeSpy.mockRestore()
  })
})

describe('migrateAnnotations — hidden field is never backfilled', () => {
  it('leaves `hidden` undefined on a pre-existing snapshot that never had the field (the upgrade case)', () => {
    const input = [makeAnnotation({ id: 'a1', status: 'applied' })]
    // Simulate a genuinely old persisted record: no `hidden` key at all.
    delete (input[0] as Partial<Annotation>).hidden
    const result = migrateAnnotations(input)
    expect(result[0].hidden).toBeUndefined()
  })

  it('preserves an explicit hidden:true through migration', () => {
    const input = [makeAnnotation({ id: 'a1', status: 'applied', hidden: true })]
    const result = migrateAnnotations(input)
    expect(result[0].hidden).toBe(true)
  })
})
