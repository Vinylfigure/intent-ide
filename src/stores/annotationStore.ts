'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Annotation, ConversationMessage } from '@/lib/annotations/types'
import { mapLegacyType, normalizeProposedEdit } from '@/lib/annotations/types'
import { useDocumentStore } from '@/stores/documentStore'

/** Migrate annotations from the old 6-type system to the new 4-type system on hydration */
function migrateAnnotations(annotations: Annotation[]): Annotation[] {
  const activeDocumentId = useDocumentStore.getState().activeDocumentId ?? 'legacy'
  return annotations.map((a) => ({
    ...a,
    documentId: a.documentId ?? activeDocumentId,
    locationGroupKey: a.locationGroupKey ?? `${a.documentId ?? activeDocumentId}:${a.anchor.from}:${a.anchor.to}`,
    type: mapLegacyType(a.type),
    resolution: a.resolution
      ? {
          ...a.resolution,
          type: mapLegacyType(a.resolution.type),
          edits: a.resolution.edits?.map(normalizeProposedEdit),
        }
      : null,
  }))
}

interface AnnotationState {
  annotations: Annotation[]
  activeAnnotationId: string | null
  add: (annotation: Annotation) => void
  update: (id: string, patch: Partial<Annotation>) => void
  remove: (id: string) => void
  setActive: (id: string | null) => void
  addMessage: (id: string, message: ConversationMessage) => void
  updateMessage: (annotationId: string, messageId: string, patch: Partial<ConversationMessage>) => void
  getById: (id: string) => Annotation | undefined
  clear: () => void
}

export const useAnnotationStore = create<AnnotationState>()(
  persist(
    (set, get) => ({
      annotations: [],
      activeAnnotationId: null,
      add: (annotation) =>
        set((s) => ({ annotations: [...s.annotations, annotation] })),
      update: (id, patch) =>
        set((s) => ({
          annotations: s.annotations.map((a) =>
            a.id === id ? { ...a, ...patch } : a
          ),
        })),
      remove: (id) =>
        set((s) => ({
          annotations: s.annotations.filter((a) => a.id !== id),
          activeAnnotationId:
            s.activeAnnotationId === id ? null : s.activeAnnotationId,
        })),
      addMessage: (id, message) =>
        set((s) => ({
          annotations: s.annotations.map((a) =>
            a.id === id ? { ...a, conversation: [...a.conversation, message] } : a
          ),
        })),
      updateMessage: (annotationId, messageId, patch) =>
        set((s) => ({
          annotations: s.annotations.map((a) =>
            a.id === annotationId
              ? {
                  ...a,
                  conversation: a.conversation.map((m) =>
                    m.id === messageId ? { ...m, ...patch } : m
                  ),
                }
              : a
          ),
        })),
      setActive: (id) => set({ activeAnnotationId: id }),
      getById: (id) => get().annotations.find((a) => a.id === id),
      clear: () => set({ annotations: [], activeAnnotationId: null }),
    }),
    {
      name: 'intent-ide-annotations',
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.annotations = migrateAnnotations(state.annotations)
        }
      },
    }
  )
)
