import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChangeEntry, ChangeSet } from '@/lib/changes/changeLog'
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
 * Loads a fresh copy of changesStore in its own module-cache generation. The
 * migration fallback no longer reads `documentStore`'s `activeDocumentId` at
 * all (that dependency was the bug — see #128), so the currently-active
 * document is set up here only to prove it has no bearing on the outcome,
 * not because migration consults it.
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

describe('changesStore — legacy documentId migration (#128: fixed placeholder, never the active document)', () => {
  it('backfills a missing documentId to the fixed LEGACY_DOCUMENT_ID even when a document is active, and the record is NOT visible to that document\'s filter', async () => {
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
    expect(entries[0].documentId).toBe(LEGACY_DOCUMENT_ID)
    expect(changeSets[0].documentId).toBe(LEGACY_DOCUMENT_ID)

    // Critically, NOT visible to the active document's filter — reusing
    // activeDocumentId here is exactly the contamination #128 fixed.
    expect(entries.filter((e) => e.documentId === 'doc-active')).toHaveLength(0)
    expect(changeSets.filter((cs) => cs.documentId === 'doc-active')).toHaveLength(0)
  })

  it('falls back to LEGACY_DOCUMENT_ID when no active document exists at rehydration time', async () => {
    const legacyEntry = makeEntry({ documentId: undefined as unknown as string })
    localStorage.setItem(
      'intent-ide-changes',
      JSON.stringify({ state: { entries: [legacyEntry], changeSets: [] }, version: 0 })
    )

    const { useChangesStore } = await loadStores(null)

    expect(useChangesStore.getState().entries[0].documentId).toBe(LEGACY_DOCUMENT_ID)
  })

  it('two distinct pre-migration documents\' worth of legacy records collapse onto the SAME fixed placeholder, not onto whichever document happens to be active', async () => {
    // Simulates a user who used the app across two separate documents before
    // multi-document support existed — neither record carries anything that
    // could tell them apart, which is the documented, accepted limitation.
    const fromDocA = makeEntry({ id: 'entry-from-doc-a', documentId: undefined as unknown as string, description: 'Edit from old session A' })
    const fromDocB = makeEntry({ id: 'entry-from-doc-b', documentId: undefined as unknown as string, description: 'Edit from old session B' })
    localStorage.setItem(
      'intent-ide-changes',
      JSON.stringify({ state: { entries: [fromDocA, fromDocB], changeSets: [] }, version: 0 })
    )

    const { useChangesStore } = await loadStores('doc-currently-open')

    const { entries } = useChangesStore.getState()
    expect(entries.map((e) => e.documentId)).toEqual([LEGACY_DOCUMENT_ID, LEGACY_DOCUMENT_ID])
    // Both land in the shared placeholder bucket together, not in the
    // currently-open document's history.
    expect(entries.filter((e) => e.documentId === 'doc-currently-open')).toHaveLength(0)
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
    expect(byId['entry-legacy']).toBe(LEGACY_DOCUMENT_ID)
    expect(byId['entry-modern']).toBe('doc-modern')
  })

  it('is idempotent — rehydrating an already-migrated record does not change it', async () => {
    const entry = makeEntry({ documentId: 'doc-active' })
    localStorage.setItem(
      'intent-ide-changes',
      JSON.stringify({ state: { entries: [entry], changeSets: [] }, version: 0 })
    )

    const { useChangesStore } = await loadStores('doc-different')

    // Already had a real documentId — must not be overwritten by anything,
    // only backfilled when missing.
    expect(useChangesStore.getState().entries[0].documentId).toBe('doc-active')
  })
})

describe('migrateChanges — direct unit coverage', () => {
  it('backfills entries and changeSets independently to LEGACY_DOCUMENT_ID, ignoring any active document', async () => {
    const { migrateChanges } = await loadStores('doc-active')
    const result = migrateChanges(
      [makeEntry({ documentId: undefined as unknown as string })],
      [makeChangeSet({ documentId: undefined as unknown as string })]
    )
    expect(result.entries[0].documentId).toBe(LEGACY_DOCUMENT_ID)
    expect(result.changeSets[0].documentId).toBe(LEGACY_DOCUMENT_ID)
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
