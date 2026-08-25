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

function makeAnnotation(id: string): Annotation {
  return {
    id,
    documentId: 'doc-1',
    locationGroupKey: `doc-1:0:10`,
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

// Regression for #103: a held answer for an annotation that gets removed
// previously stayed in useFlowStore.heldAnswers forever, since no poll for a
// gone annotation can ever fire shouldRevealAnswer to clear it. remove() has
// no production call site today, but must purge the hold itself defensively
// rather than rely on callers to remember to do so.
describe('annotationStore.remove() purges the matching heldAnswers entry (#103)', () => {
  it('removes a held answer for the same id', async () => {
    const { useAnnotationStore, useFlowStore } = await loadStores()
    useAnnotationStore.getState().add(makeAnnotation('ann-1'))
    useFlowStore.getState().holdAnswer('ann-1', 2000)
    expect(useFlowStore.getState().heldAnswers['ann-1']).toBeDefined()

    useAnnotationStore.getState().remove('ann-1')

    expect(useFlowStore.getState().heldAnswers['ann-1']).toBeUndefined()
  })

  it('removing an annotation with no held answer is a no-op on heldAnswers', async () => {
    const { useAnnotationStore, useFlowStore } = await loadStores()
    useAnnotationStore.getState().add(makeAnnotation('ann-1'))
    useFlowStore.getState().holdAnswer('ann-2', 2000)

    useAnnotationStore.getState().remove('ann-1')

    expect(useFlowStore.getState().heldAnswers['ann-2']).toBeDefined()
  })

  it('does not disturb held answers belonging to other annotations', async () => {
    const { useAnnotationStore, useFlowStore } = await loadStores()
    useAnnotationStore.getState().add(makeAnnotation('ann-1'))
    useAnnotationStore.getState().add(makeAnnotation('ann-2'))
    useFlowStore.getState().holdAnswer('ann-1', 2000)
    useFlowStore.getState().holdAnswer('ann-2', 3000)

    useAnnotationStore.getState().remove('ann-1')

    expect(useFlowStore.getState().heldAnswers['ann-1']).toBeUndefined()
    expect(useFlowStore.getState().heldAnswers['ann-2']).toBeDefined()
  })
})

// Regression for #103 (extended after adversarial review): `remove()` has no
// production call site today — the real reachable leak is `clear()`, called
// on every new/paste/generate/import document action in DocInputModal.tsx,
// which previously wiped every annotation without touching a single held
// answer.
describe('annotationStore.clear() purges every heldAnswers entry (#103)', () => {
  it('drops all held answers when every annotation is wiped', async () => {
    const { useAnnotationStore, useFlowStore } = await loadStores()
    useAnnotationStore.getState().add(makeAnnotation('ann-1'))
    useAnnotationStore.getState().add(makeAnnotation('ann-2'))
    useFlowStore.getState().holdAnswer('ann-1', 2000)
    useFlowStore.getState().holdAnswer('ann-2', 3000)

    useAnnotationStore.getState().clear()

    expect(useFlowStore.getState().heldAnswers).toEqual({})
  })

  it('is a no-op on heldAnswers when there are none held', async () => {
    const { useAnnotationStore, useFlowStore } = await loadStores()
    useAnnotationStore.getState().add(makeAnnotation('ann-1'))

    useAnnotationStore.getState().clear()

    expect(useFlowStore.getState().heldAnswers).toEqual({})
  })
})
