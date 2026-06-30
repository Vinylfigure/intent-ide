'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Annotation } from '@/lib/annotations/types'
import type { ChangeEntry, ChangeSet, ChangeSetStatus, VersionSnapshot } from '@/lib/changes/changeLog'
import { generateId } from '@/lib/utils/id'

const MAX_PERSISTED_ENTRIES = 500
const MAX_PERSISTED_CHANGE_SETS = 100
const EMERGENCY_ENTRIES = 100
const EMERGENCY_CHANGE_SETS = 50

interface ChangesState {
  entries: ChangeEntry[]
  changeSets: ChangeSet[]
  snapshots: VersionSnapshot[]
  addEntry: (entry: ChangeEntry) => void
  undoEntry: (id: string) => void
  getEntry: (id: string) => ChangeEntry | undefined
  createSnapshot: (docJson: any) => void
  ensureChangeSetForAnnotation: (annotation: Annotation) => string | null
  linkAuditToAnnotation: (annotation: Annotation, auditRecordId: string) => void
  updateChangeSetStatus: (id: string, status: ChangeSetStatus) => void
  getChangeSetByAnnotationId: (annotationId: string) => ChangeSet | undefined
  clear: () => void
}

function getRootAnnotationId(annotation: Annotation): string | null {
  return annotation.parentId ?? annotation.id
}

function buildChangeSetTitle(annotation: Annotation): string {
  const transcript = annotation.transcript.trim()
  if (!transcript) return 'Untitled review thread'
  return transcript.length > 72 ? `${transcript.slice(0, 69)}...` : transcript
}

export const useChangesStore = create<ChangesState>()(
  persist(
    (set, get) => ({
      entries: [],
      changeSets: [],
      snapshots: [],

      addEntry: (entry) =>
        set((s) => {
          const nextEntries = [...s.entries, entry]
          let nextChangeSets = s.changeSets

          if (entry.rootAnnotationId) {
            const existing = s.changeSets.find((changeSet) => changeSet.rootAnnotationId === entry.rootAnnotationId)
            if (existing) {
              nextChangeSets = s.changeSets.map((changeSet) =>
                changeSet.id === existing.id
                  ? {
                      ...changeSet,
                      changeEntryIds: changeSet.changeEntryIds.includes(entry.id)
                        ? changeSet.changeEntryIds
                        : [...changeSet.changeEntryIds, entry.id],
                      updatedAt: entry.timestamp,
                    }
                  : changeSet
              )
            }
          }

          return {
            entries: nextEntries,
            changeSets: nextChangeSets,
          }
        }),

      undoEntry: (id) =>
        set((s) => ({
          entries: s.entries.map((e) =>
            e.id === id ? { ...e, undone: true } : e
          ),
        })),

      getEntry: (id) => get().entries.find((e) => e.id === id),

      createSnapshot: (docJson) =>
        set((s) => ({
          snapshots: [
            ...s.snapshots,
            {
              id: `snap-${Date.now()}`,
              docJson,
              changeIds: s.entries.filter((e) => !e.undone).map((e) => e.id),
              timestamp: Date.now(),
            },
          ],
        })),

      ensureChangeSetForAnnotation: (annotation) => {
        if (annotation.parentId) {
          const root = get().changeSets.find((changeSet) =>
            changeSet.annotationIds.includes(annotation.parentId as string)
          )
          if (root) {
            set((s) => ({
              changeSets: s.changeSets.map((changeSet) =>
                changeSet.id === root.id
                  ? {
                      ...changeSet,
                      annotationIds: changeSet.annotationIds.includes(annotation.id)
                        ? changeSet.annotationIds
                        : [...changeSet.annotationIds, annotation.id],
                      updatedAt: Date.now(),
                    }
                  : changeSet
              ),
            }))
            return root.id
          }
        }

        const rootAnnotationId = getRootAnnotationId(annotation)
        if (!rootAnnotationId) return null

        const existing = get().changeSets.find((changeSet) => changeSet.rootAnnotationId === rootAnnotationId)
        if (existing) {
          set((s) => ({
            changeSets: s.changeSets.map((changeSet) =>
              changeSet.id === existing.id
                ? {
                    ...changeSet,
                    annotationIds: changeSet.annotationIds.includes(annotation.id)
                      ? changeSet.annotationIds
                      : [...changeSet.annotationIds, annotation.id],
                    updatedAt: Date.now(),
                  }
                : changeSet
            ),
          }))
          return existing.id
        }

        const changeSetId = generateId()
        const now = Date.now()
        set((s) => ({
          changeSets: [
            ...s.changeSets,
            {
              id: changeSetId,
              documentId: annotation.documentId,
              rootAnnotationId,
              annotationIds: [annotation.id],
              changeEntryIds: [],
              auditRecordIds: [],
              title: buildChangeSetTitle(annotation),
              status: 'pending',
              updatedAt: now,
            },
          ],
        }))
        return changeSetId
      },

      linkAuditToAnnotation: (annotation, auditRecordId) => {
        const changeSetId = get().ensureChangeSetForAnnotation(annotation)
        if (!changeSetId) return

        set((s) => ({
          changeSets: s.changeSets.map((changeSet) =>
            changeSet.id === changeSetId
              ? {
                  ...changeSet,
                  auditRecordIds: changeSet.auditRecordIds.includes(auditRecordId)
                    ? changeSet.auditRecordIds
                    : [...changeSet.auditRecordIds, auditRecordId],
                  updatedAt: Date.now(),
                }
              : changeSet
          ),
        }))
      },

      updateChangeSetStatus: (id, status) =>
        set((s) => ({
          changeSets: s.changeSets.map((changeSet) =>
            changeSet.id === id
              ? { ...changeSet, status, updatedAt: Date.now() }
              : changeSet
          ),
        })),

      getChangeSetByAnnotationId: (annotationId) =>
        get().changeSets.find((changeSet) => changeSet.annotationIds.includes(annotationId)),

      clear: () => set({ entries: [], changeSets: [], snapshots: [] }),
    }),
    {
      name: 'intent-ide-changes',
      partialize: (state) => ({
        entries: state.entries.slice(-MAX_PERSISTED_ENTRIES),
        changeSets: state.changeSets.slice(-MAX_PERSISTED_CHANGE_SETS),
        // snapshots excluded — full docJson already persisted separately under intent-ide-doc:{id}
      }),
      storage: {
        getItem: (name: string) => {
          try {
            const raw = localStorage.getItem(name)
            return raw ? JSON.parse(raw) : null
          } catch {
            return null
          }
        },
        setItem: (name: string, value: unknown) => {
          try {
            localStorage.setItem(name, JSON.stringify(value))
          } catch {
            // Quota exceeded — emergency prune and retry
            // Zustand persist v4 wraps in { state: {...}, version: N }
            try {
              const parsed = JSON.parse(JSON.stringify(value)) as Record<string, unknown>
              const inner = (parsed.state ?? parsed) as Record<string, unknown[]>
              inner.entries = (inner.entries ?? []).slice(-EMERGENCY_ENTRIES)
              inner.changeSets = (inner.changeSets ?? []).slice(-EMERGENCY_CHANGE_SETS)
              localStorage.setItem(name, JSON.stringify(parsed))
            } catch {
              // Silently fail — in-memory state is still valid
            }
          }
        },
        removeItem: (name: string) => localStorage.removeItem(name),
      },
      onRehydrateStorage: () => () => {
        // Snapshots are not persisted — ensure empty array on rehydration
        const current = useChangesStore.getState()
        if (!current.snapshots || current.snapshots.length === 0) {
          useChangesStore.setState({ snapshots: [] })
        }
      },
    }
  )
)
