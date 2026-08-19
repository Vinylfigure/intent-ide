import { beforeEach, describe, expect, it, vi } from 'vitest'

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

async function loadStore() {
  vi.resetModules()
  return import('@/stores/documentStore')
}

beforeEach(() => {
  const storage = new MemoryStorage()
  vi.stubGlobal('localStorage', storage)
})

describe('documentStore phase 8 migration and collections', () => {
  it('migrates legacy project docs into flat documents and collections once', async () => {
    localStorage.setItem('intent-ide-projects', JSON.stringify({
      state: {
        projects: [
          {
            id: 'project-1',
            name: 'Polygon',
            documents: [
              {
                id: 'legacy-doc-1',
                name: 'Spec',
                docJson: { type: 'doc', content: [] },
                createdAt: 100,
              },
            ],
          },
        ],
      },
    }))

    const { useDocumentStore } = await loadStore()

    useDocumentStore.getState().runLegacyProjectMigration()
    const firstPass = useDocumentStore.getState()
    expect(firstPass.collections).toHaveLength(1)
    expect(firstPass.collections[0].name).toBe('Polygon')
    expect(firstPass.documents).toHaveLength(1)
    expect(firstPass.documents[0].collectionIds).toEqual([firstPass.collections[0].id])

    useDocumentStore.getState().runLegacyProjectMigration()
    const secondPass = useDocumentStore.getState()
    expect(secondPass.documents).toHaveLength(1)
    expect(secondPass.collections).toHaveLength(1)
  })

  it('does not throw and still marks migration done when a legacy project has no documents array', async () => {
    localStorage.setItem('intent-ide-projects', JSON.stringify({
      state: {
        projects: [
          {
            id: 'p1',
            name: 'Corrupt',
            // no `documents` key at all — malformed legacy data
          },
        ],
      },
    }))

    const { useDocumentStore } = await loadStore()

    expect(() => useDocumentStore.getState().runLegacyProjectMigration()).not.toThrow()
    expect(useDocumentStore.getState().hasMigratedLegacyProjects).toBe(true)

    // Retrying (as would happen on the next boot) must stay a no-op, not retry forever.
    expect(() => useDocumentStore.getState().runLegacyProjectMigration()).not.toThrow()
  })

  it('drops a malformed document element (null) without losing a well-formed sibling document in the same project', async () => {
    localStorage.setItem('intent-ide-projects', JSON.stringify({
      state: {
        projects: [
          {
            id: 'p1',
            name: 'Mixed',
            documents: [
              null,
              { id: 'legacy-doc-ok', name: 'Good Doc', docJson: { type: 'doc', content: [] } },
            ],
          },
        ],
      },
    }))

    const { useDocumentStore } = await loadStore()

    expect(() => useDocumentStore.getState().runLegacyProjectMigration()).not.toThrow()
    const state = useDocumentStore.getState()
    expect(state.hasMigratedLegacyProjects).toBe(true)
    expect(state.documents.find((d) => d.id === 'legacy-doc-ok')).toBeTruthy()
  })

  it('does not lose a clean sibling project when another legacy project in the same array is malformed', async () => {
    localStorage.setItem('intent-ide-projects', JSON.stringify({
      state: {
        projects: [
          {
            id: 'good1',
            name: 'Good',
            documents: [{ id: 'legacy-doc-good', name: 'Doc1', docJson: { type: 'doc', content: [] } }],
          },
          {
            id: 'bad1',
            name: 'Bad',
            documents: [null],
          },
        ],
      },
    }))

    const { useDocumentStore } = await loadStore()

    expect(() => useDocumentStore.getState().runLegacyProjectMigration()).not.toThrow()
    const state = useDocumentStore.getState()
    expect(state.hasMigratedLegacyProjects).toBe(true)
    expect(state.documents.find((d) => d.id === 'legacy-doc-good')).toBeTruthy()
    expect(state.collections.some((c) => c.name === 'Good')).toBe(true)
  })

  it('drops a document element missing a valid id instead of migrating it as id: undefined', async () => {
    localStorage.setItem('intent-ide-projects', JSON.stringify({
      state: {
        projects: [
          {
            id: 'p1',
            name: 'NoId',
            documents: [{ name: 'Missing id', docJson: { type: 'doc', content: [] } }],
          },
        ],
      },
    }))

    const { useDocumentStore } = await loadStore()

    expect(() => useDocumentStore.getState().runLegacyProjectMigration()).not.toThrow()
    const state = useDocumentStore.getState()
    expect(state.hasMigratedLegacyProjects).toBe(true)
    expect(state.documents.some((d) => d.id === undefined || d.id === 'undefined')).toBe(false)
  })

  it('assigns and removes documents from collections', async () => {
    const { useDocumentStore } = await loadStore()
    const store = useDocumentStore.getState()

    const docId = store.createDocument('Doc', { type: 'doc', content: [] })
    const collectionId = store.createCollection('Research')

    useDocumentStore.getState().assignDocumentToCollection(docId, collectionId)
    expect(useDocumentStore.getState().documents[0].collectionIds).toEqual([collectionId])

    useDocumentStore.getState().removeDocumentFromCollection(docId, collectionId)
    expect(useDocumentStore.getState().documents[0].collectionIds).toEqual([])
  })
})
