'use client'

import { useMemo, useState } from 'react'
import { useDocumentStore, type CollectionMeta, type DocumentMeta } from '@/stores/documentStore'

function sortDocsByRecent(docs: DocumentMeta[]): DocumentMeta[] {
  return [...docs].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function DocumentHubSidebar() {
  const documents = useDocumentStore((s) => s.documents)
  const collections = useDocumentStore((s) => s.collections)
  const activeDocumentId = useDocumentStore((s) => s.activeDocumentId)
  const setActiveDocument = useDocumentStore((s) => s.setActiveDocument)
  const renameDocument = useDocumentStore((s) => s.renameDocument)
  const duplicateDocument = useDocumentStore((s) => s.duplicateDocument)
  const deleteDocument = useDocumentStore((s) => s.deleteDocument)
  const createCollection = useDocumentStore((s) => s.createCollection)
  const renameCollection = useDocumentStore((s) => s.renameCollection)
  const deleteCollection = useDocumentStore((s) => s.deleteCollection)
  const assignDocumentToCollection = useDocumentStore((s) => s.assignDocumentToCollection)
  const removeDocumentFromCollection = useDocumentStore((s) => s.removeDocumentFromCollection)

  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set())
  const [renamingDocId, setRenamingDocId] = useState<string | null>(null)
  const [renamingCollectionId, setRenamingCollectionId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [showNewCollection, setShowNewCollection] = useState(false)
  const [newCollectionName, setNewCollectionName] = useState('')

  const docsByCollection = useMemo(() => {
    return collections.reduce<Record<string, DocumentMeta[]>>((acc, collection) => {
      acc[collection.id] = sortDocsByRecent(
        documents.filter((doc) => (doc.collectionIds ?? []).includes(collection.id))
      )
      return acc
    }, {})
  }, [collections, documents])

  const ungroupedDocs = useMemo(
    () => sortDocsByRecent(documents.filter((doc) => (doc.collectionIds ?? []).length === 0)),
    [documents]
  )

  const allDocs = useMemo(() => sortDocsByRecent(documents), [documents])

  const startRenameDocument = (doc: DocumentMeta) => {
    setRenamingCollectionId(null)
    setRenamingDocId(doc.id)
    setRenameValue(doc.title)
  }

  const startRenameCollection = (collection: CollectionMeta) => {
    setRenamingDocId(null)
    setRenamingCollectionId(collection.id)
    setRenameValue(collection.name)
  }

  const commitRename = () => {
    if (!renameValue.trim()) {
      setRenamingDocId(null)
      setRenamingCollectionId(null)
      return
    }

    if (renamingDocId) {
      renameDocument(renamingDocId, renameValue.trim())
    }

    if (renamingCollectionId) {
      renameCollection(renamingCollectionId, renameValue.trim())
    }

    setRenamingDocId(null)
    setRenamingCollectionId(null)
  }

  const createNewCollection = () => {
    if (!newCollectionName.trim()) return
    const id = createCollection(newCollectionName.trim())
    setExpandedCollections((prev) => new Set(prev).add(id))
    setNewCollectionName('')
    setShowNewCollection(false)
  }

  const toggleCollection = (id: string) => {
    setExpandedCollections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="p-4 space-y-5 h-full overflow-y-auto">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('intent-ide:new-doc'))}
          className="flex-1 px-3 py-2.5 bg-ink text-white rounded-xl text-sm font-medium hover:bg-ink/85 transition-colors shadow-sm"
        >
          New Document
        </button>
        <button
          onClick={() => setShowNewCollection((prev) => !prev)}
          className="px-3 py-2.5 text-xs font-medium border border-dashed border-border/80 rounded-xl bg-white/60 hover:bg-white transition-colors"
        >
          New Collection
        </button>
      </div>

      {showNewCollection && (
        <div className="flex gap-2 rounded-2xl border border-border/70 bg-white/70 p-2">
          <input
            value={newCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createNewCollection()
              if (e.key === 'Escape') setShowNewCollection(false)
            }}
            placeholder="Collection name..."
            autoFocus
            className="flex-1 px-3 py-2 text-sm border border-border/70 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          <button
            onClick={createNewCollection}
            className="px-3 py-2 text-xs font-medium bg-accent text-white rounded-xl hover:bg-accent/85 transition-colors"
          >
            Add
          </button>
        </div>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-mono uppercase tracking-wider text-ink/60">
            All documents
          </h2>
          <span className="text-xs font-mono text-ink/50">{allDocs.length}</span>
        </div>
        <div className="space-y-1">
          {allDocs.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              collections={collections}
              isActive={activeDocumentId === doc.id}
              renaming={renamingDocId === doc.id}
              renameValue={renameValue}
              onRenameValueChange={setRenameValue}
              onCommitRename={commitRename}
              onCancelRename={() => setRenamingDocId(null)}
              onActivate={() => setActiveDocument(doc.id)}
              onStartRename={() => startRenameDocument(doc)}
              onDuplicate={() => duplicateDocument(doc.id)}
              onDelete={() => deleteDocument(doc.id)}
              onAssignToCollection={(collectionId) => assignDocumentToCollection(doc.id, collectionId)}
              onRemoveFromCollection={(collectionId) => removeDocumentFromCollection(doc.id, collectionId)}
            />
          ))}
          {allDocs.length === 0 && (
            <p className="text-xs text-ink/40 py-4 text-center">
              No documents yet.
            </p>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-mono uppercase tracking-wider text-ink/60">
            Collections
          </h2>
          <span className="text-xs font-mono text-ink/50">{collections.length}</span>
        </div>

        {collections.map((collection) => {
          const isExpanded = expandedCollections.has(collection.id)
          const collectionDocs = docsByCollection[collection.id] ?? []

          return (
            <div key={collection.id} className="border border-border/70 rounded-2xl overflow-hidden bg-white/75 shadow-sm">
              <div
                className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-warm/60 transition-colors"
                onClick={() => toggleCollection(collection.id)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] text-ink/40">
                    {isExpanded ? '\u25BC' : '\u25B6'}
                  </span>
                  {renamingCollectionId === collection.id ? (
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename()
                        if (e.key === 'Escape') setRenamingCollectionId(null)
                      }}
                      onBlur={commitRename}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                      className="flex-1 px-1 py-0.5 text-sm border border-accent rounded focus:outline-none"
                    />
                  ) : (
                    <span className="text-sm font-medium truncate text-ink">{collection.name}</span>
                  )}
                  <span className="status-chip px-1.5 py-0.5 rounded-full text-[10px]">({collectionDocs.length})</span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      startRenameCollection(collection)
                    }}
                    className="p-0.5 text-xs text-ink/45 hover:text-ink"
                    title="Rename collection"
                  >
                    \u270E
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteCollection(collection.id)
                    }}
                    className="p-0.5 text-xs text-red-400 hover:text-red-600"
                    title="Delete collection"
                  >
                    \u2715
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-border/70 bg-gradient-to-b from-white/70 to-white/50">
                  {collectionDocs.map((doc) => (
                    <DocumentRow
                      key={doc.id}
                      doc={doc}
                      collections={collections}
                      isActive={activeDocumentId === doc.id}
                      renaming={renamingDocId === doc.id}
                      renameValue={renameValue}
                      onRenameValueChange={setRenameValue}
                      onCommitRename={commitRename}
                      onCancelRename={() => setRenamingDocId(null)}
                      onActivate={() => setActiveDocument(doc.id)}
                      onStartRename={() => startRenameDocument(doc)}
                      onDuplicate={() => duplicateDocument(doc.id)}
                      onDelete={() => deleteDocument(doc.id)}
                      onAssignToCollection={(collectionId) => assignDocumentToCollection(doc.id, collectionId)}
                      onRemoveFromCollection={(collectionId) => removeDocumentFromCollection(doc.id, collectionId)}
                      compact
                    />
                  ))}
                  {collectionDocs.length === 0 && (
                    <p className="px-4 py-3 text-xs text-ink/40">No documents in this collection.</p>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {ungroupedDocs.length > 0 && (
          <div className="rounded-2xl border border-dashed border-border/80 px-3 py-3 bg-white/55">
            <p className="text-xs font-mono uppercase tracking-wider text-ink/50 mb-2">
              Ungrouped
            </p>
            <div className="space-y-1">
              {ungroupedDocs.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => setActiveDocument(doc.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-xl text-xs transition-colors ${
                    activeDocumentId === doc.id ? 'bg-accent/10 text-accent shadow-sm' : 'hover:bg-white/70'
                  }`}
                >
                  {doc.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

interface DocumentRowProps {
  doc: DocumentMeta
  collections: CollectionMeta[]
  isActive: boolean
  renaming: boolean
  renameValue: string
  onRenameValueChange: (value: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
  onActivate: () => void
  onStartRename: () => void
  onDuplicate: () => void
  onDelete: () => void
  onAssignToCollection: (collectionId: string) => void
  onRemoveFromCollection: (collectionId: string) => void
  compact?: boolean
}

function DocumentRow({
  doc,
  collections,
  isActive,
  renaming,
  renameValue,
  onRenameValueChange,
  onCommitRename,
  onCancelRename,
  onActivate,
  onStartRename,
  onDuplicate,
  onDelete,
  onAssignToCollection,
  onRemoveFromCollection,
  compact = false,
}: DocumentRowProps) {
  return (
    <div
      className={`rounded-2xl border border-border/70 px-3 py-2.5 transition-all ${isActive ? 'bg-accent/10 border-accent/30 shadow-sm' : 'bg-white/70 hover:bg-white'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div onClick={onActivate} className="min-w-0 flex-1 text-left cursor-pointer">
          {renaming ? (
            <input
              value={renameValue}
              onChange={(e) => onRenameValueChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCommitRename()
                if (e.key === 'Escape') onCancelRename()
              }}
              onBlur={onCommitRename}
              autoFocus
              className="w-full px-1 py-0.5 text-sm border border-accent rounded focus:outline-none"
            />
          ) : (
            <>
              <p className={`truncate text-ink ${compact ? 'text-xs' : 'text-sm font-medium'}`}>{doc.title}</p>
              {!compact && (
                <p className="text-xs font-mono text-ink/45">
                  Updated {new Date(doc.updatedAt).toLocaleString()}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onStartRename} className="w-7 h-7 rounded-full text-xs text-ink/45 hover:text-ink hover:bg-warm transition-colors" title="Rename document">
            \u270E
          </button>
          <button onClick={onDuplicate} className="w-7 h-7 rounded-full text-xs text-ink/45 hover:text-ink hover:bg-warm transition-colors" title="Duplicate document">
            \u2398
          </button>
          <button onClick={onDelete} className="w-7 h-7 rounded-full text-xs text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete document">
            \u2715
          </button>
        </div>
      </div>

      {!compact && (
        <div className="mt-2 space-y-2">
          {(doc.collectionIds ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {(doc.collectionIds ?? []).map((collectionId) => {
                const collection = collections.find((item) => item.id === collectionId)
                if (!collection) return null
                return (
                  <button
                    key={collection.id}
                    onClick={() => onRemoveFromCollection(collection.id)}
                    className="px-2 py-0.5 rounded-full bg-warm text-xs font-medium text-ink/50 hover:text-ink transition-colors shadow-sm"
                    title="Remove from collection"
                  >
                    {collection.name} \u00D7
                  </button>
                )
              })}
            </div>
          )}

          <select
            defaultValue=""
            onChange={(e) => {
              const value = e.target.value
              if (!value) return
              onAssignToCollection(value)
              e.currentTarget.value = ''
            }}
            className="w-full px-2.5 py-2 text-xs border border-border/70 rounded-xl bg-white"
          >
            <option value="">Add to collection...</option>
            {collections
              .filter((collection) => !(doc.collectionIds ?? []).includes(collection.id))
              .map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name}
                </option>
              ))}
          </select>
        </div>
      )}
    </div>
  )
}
