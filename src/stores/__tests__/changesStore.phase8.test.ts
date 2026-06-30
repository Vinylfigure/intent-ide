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

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'ann-1',
    documentId: 'doc-1',
    locationGroupKey: 'doc-1:1:10',
    type: 'edit',
    status: 'resolved',
    transcript: 'Tighten this paragraph',
    anchor: { from: 1, to: 10, scope: 'paragraph', text: 'Original text' },
    resolution: null,
    conversation: [],
    parentId: null,
    childIds: [],
    createdAt: 100,
    resolvedAt: 200,
    verbosity: 'concise',
    ...overrides,
  }
}

async function loadStore() {
  vi.resetModules()
  return import('@/stores/changesStore')
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
})

describe('changesStore phase 8 change sets', () => {
  it('creates one change set per root annotation and folds child annotations into it', async () => {
    const { useChangesStore } = await loadStore()
    const root = makeAnnotation()
    const child = makeAnnotation({ id: 'ann-2', parentId: root.id, transcript: 'Follow-up' })

    const rootChangeSetId = useChangesStore.getState().ensureChangeSetForAnnotation(root)
    const childChangeSetId = useChangesStore.getState().ensureChangeSetForAnnotation(child)

    expect(rootChangeSetId).toBeTruthy()
    expect(childChangeSetId).toBe(rootChangeSetId)

    const changeSet = useChangesStore.getState().changeSets[0]
    expect(changeSet.annotationIds).toEqual(['ann-1', 'ann-2'])
  })

  it('links audit records and change entries to the owning change set', async () => {
    const { useChangesStore } = await loadStore()
    const annotation = makeAnnotation()
    const changeSetId = useChangesStore.getState().ensureChangeSetForAnnotation(annotation)
    expect(changeSetId).toBeTruthy()

    useChangesStore.getState().linkAuditToAnnotation(annotation, 'audit-1')
    useChangesStore.getState().addEntry({
      id: 'entry-1',
      documentId: 'doc-1',
      rootAnnotationId: annotation.id,
      annotationId: annotation.id,
      timestamp: 300,
      description: 'Applied edit',
      beforeSlice: 'old',
      afterSlice: 'new',
      from: 1,
      to: 10,
      pmStep: null,
      undone: false,
    })

    const changeSet = useChangesStore.getState().changeSets[0]
    expect(changeSet.auditRecordIds).toEqual(['audit-1'])
    expect(changeSet.changeEntryIds).toEqual(['entry-1'])
  })
})
