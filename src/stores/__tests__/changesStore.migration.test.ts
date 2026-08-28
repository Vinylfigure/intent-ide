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

function makeEntry(overrides: Partial<ChangeEntry> = {}): ChangeEntry {
  return {
    id: 'entry-1',
    documentId: 'doc-1',
    rootAnnotationId: null,
    annotationId: null,
    timestamp: 100,
    description: 'Applied edit',
    beforeSlice: 'old',
    afterSlice: 'new',
    from: 1,
    to: 10,
    pmStep: null,
    undone: false,
    ...overrides,
  }
}

function makeChangeSet(overrides: Partial<ChangeSet> = {}): ChangeSet {
  return {
    id: 'cs-1',
    documentId: 'doc-1',
    rootAnnotationId: 'ann-1',
    annotationIds: ['ann-1'],
    changeEntryIds: ['entry-1'],
    auditRecordIds: [],
    title: 'Test change set',
    status: 'pending',
    updatedAt: 100,
    ...overrides,
  }
}

/**
 * Loads a fresh copy of both stores in the same module-cache generation
 * (matching production, where changesStore.ts statically imports
 * documentStore.ts) and seeds documentStore's activeDocumentId BEFORE
 * changesStore's persist hydration runs at import time.
 */
async function loadStores(activeDocumentId: string | null) {
  vi.resetModules()
  const { useDocumentStore } = await import('@/stores/documentStore')
  useDocumentStore.setState({ activeDocumentId })
  const changesStore = await import('@/stores/changesStore')
  return { useDocumentStore, ...changesStore }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
})

describe('changesStore — legacy documentId migration', () => {
  it('backfills a missing documentId on entries and changeSets using activeDocumentId, and the record becomes visible to a documentId === activeDocumentId filter', async () => {
    const legacyEntry = makeEntry({ documentId: undefined as unknown as string })
    const legacyChangeSet = makeChangeSet({ documentId: undefined as unknown as string })
    localStorage.setItem(
      'intent-ide-changes',
      JSON.stringify({
        state: { entries: [legacyEntry], changeSets: [legacyChangeSet] },
        version: 0,
      })
    )

    const { useChangesStore } = await loadStores('doc-active')

    const { entries, changeSets } = useChangesStore.getState()
    expect(entries[0].documentId).toBe('doc-active')
    expect(changeSets[0].documentId).toBe('doc-active')

    // Now visible to the same filter ChangesPanel.tsx / StatusBar.tsx use.
    expect(entries.filter((e) => e.documentId === 'doc-active')).toHaveLength(1)
    expect(changeSets.filter((cs) => cs.documentId === 'doc-active')).toHaveLength(1)
  })

  it('falls back to "legacy" when no active document exists at rehydration time', async () => {
    const legacyEntry = makeEntry({ documentId: undefined as unknown as string })
    localStorage.setItem(
      'intent-ide-changes',
      JSON.stringify({ state: { entries: [legacyEntry], changeSets: [] }, version: 0 })
    )

    const { useChangesStore } = await loadStores(null)

    expect(useChangesStore.getState().entries[0].documentId).toBe('legacy')
  })

  it('leaves an already-populated documentId untouched', async () => {
    const entry = makeEntry({ documentId: 'doc-real' })
    const changeSet = makeChangeSet({ documentId: 'doc-real' })
    localStorage.setItem(
      'intent-ide-changes',
      JSON.stringify({ state: { entries: [entry], changeSets: [changeSet] }, version: 0 })
    )

    const { useChangesStore } = await loadStores('doc-active')

    expect(useChangesStore.getState().entries[0].documentId).toBe('doc-real')
    expect(useChangesStore.getState().changeSets[0].documentId).toBe('doc-real')
  })

  it('does not disturb entries that already carry a documentId when mixed with legacy ones', async () => {
    const legacy = makeEntry({ id: 'entry-legacy', documentId: undefined as unknown as string })
    const modern = makeEntry({ id: 'entry-modern', documentId: 'doc-modern' })
    localStorage.setItem(
      'intent-ide-changes',
      JSON.stringify({ state: { entries: [legacy, modern], changeSets: [] }, version: 0 })
    )

    const { useChangesStore } = await loadStores('doc-active')

    const byId = Object.fromEntries(
      useChangesStore.getState().entries.map((e) => [e.id, e.documentId])
    )
    expect(byId['entry-legacy']).toBe('doc-active')
    expect(byId['entry-modern']).toBe('doc-modern')
  })

  it('is idempotent — rehydrating an already-migrated record does not change it', async () => {
    const entry = makeEntry({ documentId: 'doc-active' })
    localStorage.setItem(
      'intent-ide-changes',
      JSON.stringify({ state: { entries: [entry], changeSets: [] }, version: 0 })
    )

    const { useChangesStore } = await loadStores('doc-different')

    // Already had a real documentId — must not be overwritten by the
    // *current* activeDocumentId, only backfilled when missing.
    expect(useChangesStore.getState().entries[0].documentId).toBe('doc-active')
  })
})

describe('migrateChanges — direct unit coverage', () => {
  it('backfills entries and changeSets independently', async () => {
    const { migrateChanges } = await loadStores('doc-active')
    const result = migrateChanges(
      [makeEntry({ documentId: undefined as unknown as string })],
      [makeChangeSet({ documentId: undefined as unknown as string })]
    )
    expect(result.entries[0].documentId).toBe('doc-active')
    expect(result.changeSets[0].documentId).toBe('doc-active')
  })

  it('does not mutate the input arrays', async () => {
    const { migrateChanges } = await loadStores('doc-active')
    const entry = makeEntry({ documentId: undefined as unknown as string })
    const entries = [entry]
    migrateChanges(entries, [])
    expect(entry.documentId).toBeUndefined()
  })

  it('returns empty arrays unchanged', async () => {
    const { migrateChanges } = await loadStores(null)
    expect(migrateChanges([], [])).toEqual({ entries: [], changeSets: [] })
  })
})
