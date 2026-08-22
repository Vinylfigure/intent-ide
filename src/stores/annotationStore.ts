'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Annotation, ConversationMessage, Resolution } from '@/lib/annotations/types'
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

/**
 * Rehydration repair for interrupted background resolves: 'pending',
 * 'classified' and 'resolving' are in-flight statuses owned by a live
 * resolveCapturedAnnotation call — after a reload no such call exists, so a
 * persisted in-flight annotation would show "Thinking..." forever. Finalize it
 * as resolved, attaching a minimal error resolution when none exists (same
 * finalize-with-error shape as the pipeline's background-failure path).
 */
export function finalizeInterruptedAnnotations(annotations: Annotation[]): Annotation[] {
  const IN_FLIGHT = new Set(['pending', 'classified', 'resolving'])
  return annotations.map((a) => {
    if (!IN_FLIGHT.has(a.status)) return a
    const resolution: Resolution =
      a.resolution ?? {
        type: a.type,
        content:
          'This annotation was interrupted before it finished. Ask again if you still need it.',
        suggestedEdit: null,
        actions: [],
      }
    return {
      ...a,
      status: 'resolved' as const,
      resolution,
      resolvedAt: a.resolvedAt ?? Date.now(),
    }
  })
}

// Sibling stores (invariantFlagStore's MAX_SURFACED, changesStore's
// MAX_PERSISTED_ENTRIES) already cap their persisted arrays; this store had
// neither a cap nor quota-error handling, so a long-lived session's
// unbounded `annotations` array could eventually blow the localStorage
// quota (see #64). 500 matches changesStore's reference cap.
const MAX_PERSISTED_ANNOTATIONS = 500
const EMERGENCY_ANNOTATIONS = 100

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
      partialize: (state) => ({
        annotations: state.annotations.slice(-MAX_PERSISTED_ANNOTATIONS),
        activeAnnotationId: state.activeAnnotationId,
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
            // Quota exceeded — emergency prune and retry.
            // Zustand persist v4 wraps in { state: {...}, version: N }.
            try {
              const parsed = JSON.parse(JSON.stringify(value)) as Record<string, unknown>
              const inner = (parsed.state ?? parsed) as Record<string, unknown>
              inner.annotations = ((inner.annotations as unknown[]) ?? []).slice(-EMERGENCY_ANNOTATIONS)
              localStorage.setItem(name, JSON.stringify(parsed))
            } catch {
              // Silently fail — in-memory state is still valid.
            }
          }
        },
        removeItem: (name: string) => localStorage.removeItem(name),
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.annotations = finalizeInterruptedAnnotations(
            migrateAnnotations(state.annotations)
          )
          // The persisted cap above can evict the annotation activeAnnotationId
          // pointed at (only possible once >MAX_PERSISTED_ANNOTATIONS accumulate,
          // which the uncapped store could never hit before now).
          if (
            state.activeAnnotationId &&
            !state.annotations.some((a) => a.id === state.activeAnnotationId)
          ) {
            state.activeAnnotationId = null
          }
        }
      },
    }
  )
)
