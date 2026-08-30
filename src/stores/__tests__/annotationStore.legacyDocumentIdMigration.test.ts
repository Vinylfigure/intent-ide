import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Annotation } from '@/lib/annotations/types'
import { LEGACY_DOCUMENT_ID } from '@/lib/documents/legacyDocumentId'

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

function makeAnnotation(overrides: Record<string, any> & { id: string }): Annotation {
  return {
    documentId: 'doc-1',
    locationGroupKey: 'doc-1:0:10',
    type: 'ask',
    status: 'resolved',
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
  } as Annotation
}

/**
 * Loads a fresh copy of annotationStore in its own module-cache generation.
 * Like changesStore's mirror of this migration, the fallback no longer reads
 * `documentStore`'s `activeDocumentId` (that dependency was the bug — #128),
 * so the currently-active document is seeded here only to prove it has no
 * bearing on the outcome.
 */
async function loadStores(activeDocumentId: string | null) {
  vi.resetModules()
  const { useDocumentStore } = await import('@/stores/documentStore')
  useDocumentStore.setState({ activeDocumentId })
  const annotationStore = await import('@/stores/annotationStore')
  return { useDocumentStore, ...annotationStore }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
})

describe('annotationStore — legacy documentId migration (#128: fixed placeholder, never the active document)', () => {
  it('backfills a missing documentId to the fixed LEGACY_DOCUMENT_ID even when a document is active, and the record is NOT visible to that document\'s filter', async () => {
    const legacy = makeAnnotation({ id: 'ann-1', documentId: undefined })
    localStorage.setItem(
      'intent-ide-annotations',
      JSON.stringify({ state: { annotations: [legacy], activeAnnotationId: null }, version: 0 })
    )

    const { useAnnotationStore } = await loadStores('doc-active')

    const { annotations } = useAnnotationStore.getState()
    expect(annotations[0].documentId).toBe(LEGACY_DOCUMENT_ID)
    // Critically, NOT visible to the active document's filter — reusing
    // activeDocumentId here is exactly the contamination #128 fixed.
    expect(annotations.filter((a) => a.documentId === 'doc-active')).toHaveLength(0)
  })

  it('falls back to LEGACY_DOCUMENT_ID when no active document exists at rehydration time', async () => {
    const legacy = makeAnnotation({ id: 'ann-1', documentId: undefined })
    localStorage.setItem(
      'intent-ide-annotations',
      JSON.stringify({ state: { annotations: [legacy], activeAnnotationId: null }, version: 0 })
    )

    const { useAnnotationStore } = await loadStores(null)

    expect(useAnnotationStore.getState().annotations[0].documentId).toBe(LEGACY_DOCUMENT_ID)
  })

  it('two distinct pre-migration documents\' worth of legacy annotations collapse onto the SAME fixed placeholder, not onto whichever document happens to be active', async () => {
    const fromDocA = makeAnnotation({ id: 'ann-from-doc-a', documentId: undefined, transcript: 'note from old session A' })
    const fromDocB = makeAnnotation({ id: 'ann-from-doc-b', documentId: undefined, transcript: 'note from old session B' })
    localStorage.setItem(
      'intent-ide-annotations',
      JSON.stringify({ state: { annotations: [fromDocA, fromDocB], activeAnnotationId: null }, version: 0 })
    )

    const { useAnnotationStore } = await loadStores('doc-currently-open')

    const { annotations } = useAnnotationStore.getState()
    expect(annotations.map((a) => a.documentId)).toEqual([LEGACY_DOCUMENT_ID, LEGACY_DOCUMENT_ID])
    expect(annotations.filter((a) => a.documentId === 'doc-currently-open')).toHaveLength(0)
  })

  it('disclosed trade-off: a migrated legacy annotation is unreachable by any documentId === activeDocumentId filter, no matter which document is open (see legacyDocumentId.ts)', async () => {
    // No document a user can actually have open carries LEGACY_DOCUMENT_ID as
    // its id (real ids come from generateId()/nanoid), so AnnotationPanel.tsx's,
    // AnnotationMap.tsx's, and StatusBar.tsx's `documentId === activeDocumentId`
    // filters can never surface this annotation for ANY active document — the
    // accepted cost of never contaminating a real one, not an oversight.
    const legacy = makeAnnotation({ id: 'ann-1', documentId: undefined })
    localStorage.setItem(
      'intent-ide-annotations',
      JSON.stringify({ state: { annotations: [legacy], activeAnnotationId: null }, version: 0 })
    )

    for (const active of ['doc-active', 'doc-currently-open', 'doc-real', null]) {
      const { useAnnotationStore } = await loadStores(active)
      const { annotations } = useAnnotationStore.getState()
      expect(annotations[0].documentId).toBe(LEGACY_DOCUMENT_ID)
      if (active !== null) {
        expect(annotations.filter((a) => a.documentId === active)).toHaveLength(0)
      }
    }
  })

  it('leaves an already-populated documentId untouched', async () => {
    const modern = makeAnnotation({ id: 'ann-modern', documentId: 'doc-real' })
    localStorage.setItem(
      'intent-ide-annotations',
      JSON.stringify({ state: { annotations: [modern], activeAnnotationId: null }, version: 0 })
    )

    const { useAnnotationStore } = await loadStores('doc-active')

    expect(useAnnotationStore.getState().annotations[0].documentId).toBe('doc-real')
  })

  it('does not disturb annotations that already carry a documentId when mixed with legacy ones', async () => {
    const legacy = makeAnnotation({ id: 'ann-legacy', documentId: undefined })
    const modern = makeAnnotation({ id: 'ann-modern', documentId: 'doc-modern' })
    localStorage.setItem(
      'intent-ide-annotations',
      JSON.stringify({ state: { annotations: [legacy, modern], activeAnnotationId: null }, version: 0 })
    )

    const { useAnnotationStore } = await loadStores('doc-active')

    const byId = Object.fromEntries(
      useAnnotationStore.getState().annotations.map((a) => [a.id, a.documentId])
    )
    expect(byId['ann-legacy']).toBe(LEGACY_DOCUMENT_ID)
    expect(byId['ann-modern']).toBe('doc-modern')
  })
})

describe('migrateAnnotations — direct unit coverage', () => {
  it('backfills documentId to LEGACY_DOCUMENT_ID, ignoring any active document', async () => {
    const { migrateAnnotations } = await loadStores('doc-active')
    const result = migrateAnnotations([makeAnnotation({ id: 'ann-1', documentId: undefined })])
    expect(result[0].documentId).toBe(LEGACY_DOCUMENT_ID)
  })

  it('backfills locationGroupKey using LEGACY_DOCUMENT_ID when both are missing', async () => {
    const { migrateAnnotations } = await loadStores('doc-active')
    const result = migrateAnnotations([
      makeAnnotation({ id: 'ann-1', documentId: undefined, locationGroupKey: undefined }),
    ])
    expect(result[0].locationGroupKey).toBe(`${LEGACY_DOCUMENT_ID}:0:10`)
  })

  it('does not mutate the input array', async () => {
    const { migrateAnnotations } = await loadStores('doc-active')
    const annotation = makeAnnotation({ id: 'ann-1', documentId: undefined })
    const input = [annotation]
    migrateAnnotations(input)
    expect(input[0].documentId).toBeUndefined()
  })

  it('returns an empty array unchanged', async () => {
    const { migrateAnnotations } = await loadStores(null)
    expect(migrateAnnotations([])).toEqual([])
  })
})
