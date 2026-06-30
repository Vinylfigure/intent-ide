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
