'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { generateId } from '@/lib/utils/id'
import { recordCommit } from '@/lib/history/commits'

export interface DocumentMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  collectionIds: string[]
}

export interface CollectionMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

interface CreateDocumentOptions {
  collectionIds?: string[]
  sourceDocId?: string | null
}

interface PersistedProjectDocument {
  id: string
  name: string
  docJson: unknown
  createdAt?: number
}

interface PersistedProject {
  id: string
  name: string
  documents: PersistedProjectDocument[]
  createdAt?: number
}

interface DocumentStoreState {
  documents: DocumentMeta[]
  collections: CollectionMeta[]
  activeDocumentId: string | null
  lastSavedAt: number | null
  isDirty: boolean
  hasMigratedLegacyProjects: boolean
  createDocument: (title: string, docJson: any, options?: CreateDocumentOptions) => string
  saveDocument: (id: string, docJson: any) => void
  loadDocumentJson: (id: string) => any | null
  deleteDocument: (id: string) => void
  renameDocument: (id: string, title: string) => void
  duplicateDocument: (id: string) => string | null
  setActiveDocument: (id: string | null) => void
  setDirty: (dirty: boolean) => void
  getRecentDocs: () => DocumentMeta[]
  createCollection: (name: string) => string
  renameCollection: (id: string, name: string) => void
  deleteCollection: (id: string) => void
  assignDocumentToCollection: (docId: string, collectionId: string) => void
  removeDocumentFromCollection: (docId: string, collectionId: string) => void
  runLegacyProjectMigration: () => void
}

const DOCUMENT_KEY_PREFIX = 'intent-ide-doc:'
const LEGACY_PROJECTS_KEY = 'intent-ide-projects'
const EMPTY_COLLECTIONS: string[] = []

function getDocumentStorageKey(id: string): string {
  return `${DOCUMENT_KEY_PREFIX}${id}`
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ')
}

function buildFingerprint(title: string, docJson: unknown): string {
  return `${normalizeTitle(title)}::${JSON.stringify(docJson)}`
}

function parseLegacyProjects(): PersistedProject[] {
  try {
    const raw = localStorage.getItem(LEGACY_PROJECTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    const state = parsed?.state ?? parsed
    if (!Array.isArray(state?.projects)) return []
    return state.projects as PersistedProject[]
  } catch {
    return []
  }
}

export const useDocumentStore = create<DocumentStoreState>()(
  persist(
    (set, get) => ({
      documents: [],
      collections: [],
      activeDocumentId: null,
      lastSavedAt: null,
      isDirty: false,
      hasMigratedLegacyProjects: false,

      createDocument: (title, docJson, options) => {
        const id = generateId()
        const now = Date.now()
        const collectionIds = [...new Set(options?.collectionIds ?? EMPTY_COLLECTIONS)]
        const documentTitle = title.trim() || 'Untitled'

        try {
          localStorage.setItem(getDocumentStorageKey(id), JSON.stringify(docJson))
        } catch {
          // ignore local storage failures for now
        }

        set((s) => ({
          documents: [
            {
              id,
              title: documentTitle,
              createdAt: now,
              updatedAt: now,
              collectionIds,
            },
            ...s.documents,
          ],
          activeDocumentId: id,
          lastSavedAt: now,
          isDirty: false,
        }))

        // Root entry in the document's version history (fire-and-forget —
        // covers blank/paste/generate/import and duplicates alike).
        recordCommit({
          docJson,
          documentId: id,
          kind: 'import',
          message: `Created "${documentTitle}"`,
          actor: 'human',
        })

        return id
      },

      saveDocument: (id, docJson) => {
        const now = Date.now()
        try {
          localStorage.setItem(getDocumentStorageKey(id), JSON.stringify(docJson))
        } catch {
          // ignore local storage failures for now
        }

        set((s) => ({
          documents: s.documents.map((d) =>
            d.id === id ? { ...d, updatedAt: now } : d
          ),
          lastSavedAt: now,
          isDirty: false,
        }))
      },

      loadDocumentJson: (id) => {
        try {
          const raw = localStorage.getItem(getDocumentStorageKey(id))
          return raw ? JSON.parse(raw) : null
        } catch {
          return null
        }
      },

      deleteDocument: (id) => {
        try {
          localStorage.removeItem(getDocumentStorageKey(id))
        } catch {
          // ignore
        }

        set((s) => ({
          documents: s.documents.filter((d) => d.id !== id),
          activeDocumentId: s.activeDocumentId === id ? null : s.activeDocumentId,
          lastSavedAt: s.activeDocumentId === id ? null : s.lastSavedAt,
          isDirty: s.activeDocumentId === id ? false : s.isDirty,
        }))
      },

      renameDocument: (id, title) =>
        set((s) => ({
          documents: s.documents.map((d) =>
            d.id === id ? { ...d, title: title.trim() || d.title } : d
          ),
        })),

      duplicateDocument: (id) => {
        const state = get()
        const original = state.documents.find((d) => d.id === id)
        if (!original) return null
        const json = state.loadDocumentJson(id)
        if (!json) return null

        return state.createDocument(`${original.title} (copy)`, json, {
          collectionIds: original.collectionIds,
          sourceDocId: id,
        })
      },

      setActiveDocument: (id) => set({ activeDocumentId: id }),
      setDirty: (dirty) => set({ isDirty: dirty }),

      getRecentDocs: () => {
        return [...get().documents].sort((a, b) => b.updatedAt - a.updatedAt)
      },

      createCollection: (name) => {
        const id = generateId()
        const now = Date.now()
        set((s) => ({
          collections: [
            ...s.collections,
            { id, name: name.trim() || 'Untitled collection', createdAt: now, updatedAt: now },
          ],
        }))
        return id
      },

      renameCollection: (id, name) =>
        set((s) => ({
          collections: s.collections.map((collection) =>
            collection.id === id
              ? { ...collection, name: name.trim() || collection.name, updatedAt: Date.now() }
              : collection
          ),
        })),

      deleteCollection: (id) =>
        set((s) => ({
          collections: s.collections.filter((collection) => collection.id !== id),
          documents: s.documents.map((doc) => ({
            ...doc,
            collectionIds: (doc.collectionIds ?? []).filter((collectionId) => collectionId !== id),
          })),
        })),

      assignDocumentToCollection: (docId, collectionId) =>
        set((s) => ({
          documents: s.documents.map((doc) =>
            doc.id === docId
              ? {
                  ...doc,
                  collectionIds: (doc.collectionIds ?? []).includes(collectionId)
                    ? (doc.collectionIds ?? [])
                    : [...(doc.collectionIds ?? []), collectionId],
                }
              : doc
          ),
          collections: s.collections.map((collection) =>
            collection.id === collectionId
              ? { ...collection, updatedAt: Date.now() }
              : collection
          ),
        })),

      removeDocumentFromCollection: (docId, collectionId) =>
        set((s) => ({
          documents: s.documents.map((doc) =>
            doc.id === docId
              ? {
                  ...doc,
                  collectionIds: (doc.collectionIds ?? []).filter((id) => id !== collectionId),
                }
              : doc
          ),
          collections: s.collections.map((collection) =>
            collection.id === collectionId
              ? { ...collection, updatedAt: Date.now() }
              : collection
          ),
        })),

      runLegacyProjectMigration: () => {
        const state = get()
        if (state.hasMigratedLegacyProjects || typeof localStorage === 'undefined') return

        const legacyProjects = parseLegacyProjects()
        if (legacyProjects.length === 0) {
          set({ hasMigratedLegacyProjects: true })
          return
        }

        const existingById = new Set(state.documents.map((doc) => doc.id))
        const existingFingerprints = new Set(
          state.documents.map((doc) => {
            const docJson = state.loadDocumentJson(doc.id)
            return buildFingerprint(doc.title, docJson)
          })
        )
        const existingCollectionByName = new Map(
          state.collections.map((collection) => [normalizeTitle(collection.name), collection])
        )

        const nextCollections = [...state.collections]
        const nextDocuments = [...state.documents]

        legacyProjects.forEach((project) => {
          const projectName = project.name?.trim() || 'Untitled collection'
          const normalizedProjectName = normalizeTitle(projectName)
          let collection = existingCollectionByName.get(normalizedProjectName)

          if (!collection) {
            collection = {
              id: generateId(),
              name: projectName,
              createdAt: project.createdAt ?? Date.now(),
              updatedAt: Date.now(),
            }
            existingCollectionByName.set(normalizedProjectName, collection)
            nextCollections.push(collection)
          }

          project.documents.forEach((legacyDoc) => {
            const title = legacyDoc.name?.trim() || 'Untitled'
            const fingerprint = buildFingerprint(title, legacyDoc.docJson)
            if (existingById.has(legacyDoc.id) || existingFingerprints.has(fingerprint)) {
              const existingDoc = nextDocuments.find((doc) => doc.id === legacyDoc.id)
                ?? nextDocuments.find((doc) => {
                  const docJson = state.loadDocumentJson(doc.id)
                  return buildFingerprint(doc.title, docJson) === fingerprint
                })

              if (existingDoc && !(existingDoc.collectionIds ?? []).includes(collection!.id)) {
                existingDoc.collectionIds = [...(existingDoc.collectionIds ?? []), collection!.id]
              }
              return
            }

            try {
              localStorage.setItem(getDocumentStorageKey(legacyDoc.id), JSON.stringify(legacyDoc.docJson))
            } catch {
              // ignore storage failures for migration
            }

            nextDocuments.push({
              id: legacyDoc.id,
              title,
              createdAt: legacyDoc.createdAt ?? Date.now(),
              updatedAt: legacyDoc.createdAt ?? Date.now(),
              collectionIds: [collection.id],
            })
            existingById.add(legacyDoc.id)
            existingFingerprints.add(fingerprint)
          })
        })

        set({
          collections: nextCollections,
          documents: nextDocuments,
          hasMigratedLegacyProjects: true,
        })
      },
    }),
    {
      name: 'intent-ide-documents',
      partialize: (state) => ({
        documents: state.documents,
        collections: state.collections,
        activeDocumentId: state.activeDocumentId,
        hasMigratedLegacyProjects: state.hasMigratedLegacyProjects,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Normalize legacy documents missing collectionIds (pre-Phase 8)
          state.documents = state.documents.map((doc) => ({
            ...doc,
            collectionIds: doc.collectionIds ?? [],
          }))
        }
        state?.runLegacyProjectMigration()
      },
    }
  )
)
