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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeLegacyDocuments(documents: unknown): PersistedProjectDocument[] {
  if (!Array.isArray(documents)) return []
  return documents.filter(
    (doc): doc is PersistedProjectDocument =>
      isPlainObject(doc) && typeof doc.id === 'string' && doc.id.length > 0
  )
}

function parseLegacyProjects(): PersistedProject[] {
  try {
    const raw = localStorage.getItem(LEGACY_PROJECTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    const state = parsed?.state ?? parsed
    if (!Array.isArray(state?.projects)) return []
    return (state.projects as unknown[]).filter(isPlainObject).map((project) => ({
      ...(project as unknown as PersistedProject),
      documents: sanitizeLegacyDocuments((project as unknown as PersistedProject).documents),
    }))
  } catch {
    return []
  }
}

// This store's persist config uses the default synchronous localStorage-backed storage
// (no custom `storage`/serialize/deserialize), so zustand's wrapped set() applies the
// in-memory state update first and only then attempts the synchronous localStorage
// write-through (see zustand's persist middleware `newImpl`). A write failure (e.g.
// QuotaExceededError) therefore never loses the intended state change — only the
// persistence side-effect fails — and it must not escape as an uncaught error. (If this
// store's persist config ever adopts a custom async storage adapter, this guarantee
// would need re-verifying against that adapter's error-propagation behavior.)
function safeSet(fn: () => void) {
  try {
    fn()
  } catch {
    // ignore persist write-through failures
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
          safeSet(() => set({ hasMigratedLegacyProjects: true }))
          return
        }

        try {
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
            // Isolated per project: one malformed legacy project must not discard
            // migration progress already accumulated from its well-formed siblings.
            try {
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
                // Isolated per document too: an id-level-valid but otherwise malformed
                // entry (e.g. a non-string `name`, an unserializable `docJson`) must not
                // take its later well-formed siblings in this same project down with it.
                try {
                  const rawName = typeof legacyDoc.name === 'string' ? legacyDoc.name : ''
                  const title = rawName.trim() || 'Untitled'
                  const fingerprint = buildFingerprint(title, legacyDoc.docJson)
                  if (existingById.has(legacyDoc.id) || existingFingerprints.has(fingerprint)) {
                    const existingIndex = nextDocuments.findIndex((doc) => doc.id === legacyDoc.id)
                    const resolvedIndex =
                      existingIndex !== -1
                        ? existingIndex
                        : nextDocuments.findIndex((doc) => {
                            const docJson = state.loadDocumentJson(doc.id)
                            return buildFingerprint(doc.title, docJson) === fingerprint
                          })

                    if (resolvedIndex !== -1) {
                      const existingDoc = nextDocuments[resolvedIndex]
                      if (!(existingDoc.collectionIds ?? []).includes(collection!.id)) {
                        nextDocuments[resolvedIndex] = {
                          ...existingDoc,
                          collectionIds: [...(existingDoc.collectionIds ?? []), collection!.id],
                        }
                      }
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
                } catch {
                  // skip this document; siblings in this and other projects survive
                }
              })
            } catch {
              // skip this project; siblings already accumulated in nextCollections/nextDocuments survive
            }
          })

          safeSet(() =>
            set({
              collections: nextCollections,
              documents: nextDocuments,
              hasMigratedLegacyProjects: true,
            })
          )
        } catch {
          // Something failed outside the per-project isolation above; never retry
          // forever against data we can't recover.
          safeSet(() => set({ hasMigratedLegacyProjects: true }))
        }
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
