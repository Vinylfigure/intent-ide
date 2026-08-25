import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Annotation } from '@/lib/annotations/types'

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string) {
    return this.store.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.store.set(key, value)
  }
  removeItem(key: string) {
    this.store.delete(key)
  }
  clear() {
    this.store.clear()
  }
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
    createdAt: Date.now(),
    resolvedAt: null,
    verbosity: 'normal',
  }
}

async function loadStores() {
  vi.resetModules()
  const [{ useAnnotationStore }, { useFlowStore }] = await Promise.all([
    import('@/stores/annotationStore'),
    import('@/stores/flowStore'),
  ])
  return { useAnnotationStore, useFlowStore }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
})

// Regression for #107: deleting a document previously left its annotations
// (and any held answers for them) in useAnnotationStore/useFlowStore forever
// — permanently unrenderable (every list/map view filters by documentId) but
// never removed, so they accumulated indefinitely.
describe('annotationStore.removeByDocumentId() (#107)', () => {
  it('removes every annotation belonging to the document', async () => {
    const { useAnnotationStore } = await loadStores()
    useAnnotationStore.getState().add(makeAnnotation('ann-1', 'doc-1'))
    useAnnotationStore.getState().add(makeAnnotation('ann-2', 'doc-1'))
    useAnnotationStore.getState().add(makeAnnotation('ann-3', 'doc-2'))

    useAnnotationStore.getState().removeByDocumentId('doc-1')

    const remaining = useAnnotationStore.getState().annotations.map((a) => a.id)
    expect(remaining).toEqual(['ann-3'])
  })

  it('also purges held answers for the removed annotations (via remove())', async () => {
    const { useAnnotationStore, useFlowStore } = await loadStores()
    useAnnotationStore.getState().add(makeAnnotation('ann-1', 'doc-1'))
    useAnnotationStore.getState().add(makeAnnotation('ann-2', 'doc-1'))
    useAnnotationStore.getState().add(makeAnnotation('ann-3', 'doc-2'))
    useFlowStore.getState().holdAnswer('ann-1', 2000)
    useFlowStore.getState().holdAnswer('ann-2', 3000)
    useFlowStore.getState().holdAnswer('ann-3', 4000)

    useAnnotationStore.getState().removeByDocumentId('doc-1')

    expect(useFlowStore.getState().heldAnswers['ann-1']).toBeUndefined()
    expect(useFlowStore.getState().heldAnswers['ann-2']).toBeUndefined()
    expect(useFlowStore.getState().heldAnswers['ann-3']).toBeDefined()
  })

  it('clears activeAnnotationId if it belonged to the deleted document', async () => {
    const { useAnnotationStore } = await loadStores()
    useAnnotationStore.getState().add(makeAnnotation('ann-1', 'doc-1'))
    useAnnotationStore.getState().setActive('ann-1')

    useAnnotationStore.getState().removeByDocumentId('doc-1')

    expect(useAnnotationStore.getState().activeAnnotationId).toBeNull()
  })

  it('is a no-op when the document has no annotations', async () => {
    const { useAnnotationStore } = await loadStores()
    useAnnotationStore.getState().add(makeAnnotation('ann-1', 'doc-1'))

    useAnnotationStore.getState().removeByDocumentId('doc-does-not-exist')

    expect(useAnnotationStore.getState().annotations.map((a) => a.id)).toEqual(['ann-1'])
  })
})
