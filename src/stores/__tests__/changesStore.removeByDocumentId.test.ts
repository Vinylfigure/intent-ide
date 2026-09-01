import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChangeEntry, ChangeSet } from '@/lib/changes/changeLog'

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

function makeEntry(id: string, documentId: string): ChangeEntry {
  return {
    id,
    documentId,
    rootAnnotationId: null,
    annotationId: null,
    timestamp: 0,
    description: 'edit',
    beforeSlice: 'before',
    afterSlice: 'after',
    from: 0,
    to: 1,
    pmStep: null,
    undone: false,
  }
}

function makeChangeSet(id: string, documentId: string): ChangeSet {
  return {
    id,
    documentId,
    rootAnnotationId: `root-${id}`,
    annotationIds: [`root-${id}`],
    changeEntryIds: [],
    auditRecordIds: [],
    title: 'Untitled review thread',
    status: 'pending',
    updatedAt: 0,
  }
}

async function loadStore() {
  vi.resetModules()
  return import('@/stores/changesStore')
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
})

// Mirrors annotationStore.ts's removeByDocumentId (#107) — changesStore had
// no equivalent, leaving no way to clear either a deleted document's entries
// or the invisible LEGACY_DOCUMENT_ID migration bucket (#133).
describe('changesStore.removeByDocumentId()', () => {
  it('removes entries and change sets belonging to the document, leaving others untouched', async () => {
    const { useChangesStore } = await loadStore()
    useChangesStore.setState({
      entries: [makeEntry('e-1', 'doc-1'), makeEntry('e-2', 'doc-1'), makeEntry('e-3', 'doc-2')],
      changeSets: [makeChangeSet('cs-1', 'doc-1'), makeChangeSet('cs-2', 'doc-2')],
    })

    useChangesStore.getState().removeByDocumentId('doc-1')

    expect(useChangesStore.getState().entries.map((e) => e.id)).toEqual(['e-3'])
    expect(useChangesStore.getState().changeSets.map((cs) => cs.id)).toEqual(['cs-2'])
  })

  it('is a no-op when the document has no entries or change sets', async () => {
    const { useChangesStore } = await loadStore()
    useChangesStore.setState({
      entries: [makeEntry('e-1', 'doc-1')],
      changeSets: [makeChangeSet('cs-1', 'doc-1')],
    })

    useChangesStore.getState().removeByDocumentId('doc-does-not-exist')

    expect(useChangesStore.getState().entries.map((e) => e.id)).toEqual(['e-1'])
    expect(useChangesStore.getState().changeSets.map((cs) => cs.id)).toEqual(['cs-1'])
  })
})
