import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Annotation } from '@/lib/annotations/types'

class MemoryStorage {
  protected store = new Map<string, string>()

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

/** Every setItem call throws QuotaExceededError — simulates a truly exhausted quota. */
class AlwaysQuotaStorage extends MemoryStorage {
  setItem(): void {
    const err = new Error('QuotaExceededError')
    err.name = 'QuotaExceededError'
    throw err
  }
}

/**
 * The first setItem call for `failingKey` throws QuotaExceededError;
 * subsequent calls (and calls for any other key — e.g. a sibling store's own
 * localStorage writes triggered as an import side effect) succeed normally.
 */
class FailOnceStorage extends MemoryStorage {
  private failed = false

  constructor(private readonly failingKey: string) {
    super()
  }

  setItem(key: string, value: string) {
    if (key === this.failingKey && !this.failed) {
      this.failed = true
      const err = new Error('QuotaExceededError')
      err.name = 'QuotaExceededError'
      throw err
    }
    super.setItem(key, value)
  }
}

function makeAnnotation(id: string): Annotation {
  return {
    id,
    documentId: 'doc-1',
    locationGroupKey: 'doc-1:0:10',
    type: 'flag',
    status: 'resolved',
    transcript: `annotation ${id}`,
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

async function loadStore() {
  vi.resetModules()
  return import('@/stores/annotationStore')
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
})

describe('annotationStore persistence bounds (#64)', () => {
  it('caps the persisted annotations array even as the in-memory array keeps growing past the cap', async () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    const { useAnnotationStore } = await loadStore()

    const TOTAL = 520
    for (let i = 0; i < TOTAL; i++) {
      useAnnotationStore.getState().add(makeAnnotation(`ann-${i}`))
    }

    // In-memory state is not trimmed — only what gets written to localStorage is.
    expect(useAnnotationStore.getState().annotations).toHaveLength(TOTAL)

    const raw = storage.getItem('intent-ide-annotations')
    expect(raw).not.toBeNull()
    const persisted = JSON.parse(raw as string)
    const persistedAnnotations = persisted.state.annotations as Annotation[]

    expect(persistedAnnotations.length).toBe(500)
    // Oldest entries are evicted first; newest are kept.
    expect(persistedAnnotations[0].id).toBe(`ann-${TOTAL - 500}`)
    expect(persistedAnnotations[persistedAnnotations.length - 1].id).toBe(`ann-${TOTAL - 1}`)
  })

  it('does not crash the store when localStorage.setItem always throws QuotaExceededError', async () => {
    vi.stubGlobal('localStorage', new AlwaysQuotaStorage())
    const { useAnnotationStore } = await loadStore()

    expect(() => useAnnotationStore.getState().add(makeAnnotation('ann-1'))).not.toThrow()
    // In-memory state still reflects the update even though persistence silently failed.
    expect(useAnnotationStore.getState().annotations).toHaveLength(1)
  })

  it('emergency-prunes to the newest EMERGENCY_ANNOTATIONS entries and retries once when the first write hits QuotaExceededError', async () => {
    const storage = new FailOnceStorage('intent-ide-annotations')
    vi.stubGlobal('localStorage', storage)
    const { useAnnotationStore } = await loadStore()

    // A single write carrying well over the emergency cap (100), so a
    // regression that drops the `.slice(-EMERGENCY_ANNOTATIONS)` prune would
    // leave the full, unpruned array on the (successful) retry instead —
    // this assertion catches that, unlike asserting length <= 100 against a
    // seed of 1 (which passes trivially either way).
    const SEED = 150
    const seeded = Array.from({ length: SEED }, (_, i) => makeAnnotation(`ann-${i}`))
    expect(() => useAnnotationStore.setState({ annotations: seeded })).not.toThrow()

    const raw = storage.getItem('intent-ide-annotations')
    expect(raw).not.toBeNull()
    const persisted = JSON.parse(raw as string)
    const persistedAnnotations = persisted.state.annotations as Annotation[]

    expect(persistedAnnotations).toHaveLength(100)
    // Newest 100 of the 150 are kept — the oldest 50 are dropped by the prune.
    expect(persistedAnnotations[0].id).toBe(`ann-${SEED - 100}`)
    expect(persistedAnnotations[persistedAnnotations.length - 1].id).toBe(`ann-${SEED - 1}`)
  })

  it('clears activeAnnotationId on rehydrate if the cap evicted the annotation it pointed at', async () => {
    const storage = new MemoryStorage()
    // Simulate an already-persisted store from a prior session where
    // activeAnnotationId survived pointing at an annotation that a later
    // write's cap evicted.
    storage.setItem(
      'intent-ide-annotations',
      JSON.stringify({
        state: {
          annotations: [makeAnnotation('ann-kept')],
          activeAnnotationId: 'ann-evicted',
        },
        version: 0,
      })
    )
    vi.stubGlobal('localStorage', storage)
    const { useAnnotationStore } = await loadStore()

    expect(useAnnotationStore.getState().activeAnnotationId).toBeNull()
    expect(useAnnotationStore.getState().annotations.map((a) => a.id)).toEqual(['ann-kept'])
  })

  it('preserves activeAnnotationId on rehydrate when it still points at a live annotation', async () => {
    const storage = new MemoryStorage()
    storage.setItem(
      'intent-ide-annotations',
      JSON.stringify({
        state: {
          annotations: [makeAnnotation('ann-kept')],
          activeAnnotationId: 'ann-kept',
        },
        version: 0,
      })
    )
    vi.stubGlobal('localStorage', storage)
    const { useAnnotationStore } = await loadStore()

    expect(useAnnotationStore.getState().activeAnnotationId).toBe('ann-kept')
  })
})
