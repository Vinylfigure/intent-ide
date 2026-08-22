'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface SessionContext {
  documentSummary: string
  annotationHistory: string
  userPatterns: string
  totalTokens: number
}

interface SessionState {
  context: SessionContext
  updateContext: (patch: Partial<SessionContext>) => void
  appendToHistory: (entry: string) => void
  reset: () => void
}

const initialContext: SessionContext = {
  documentSummary: '',
  annotationHistory: '',
  userPatterns: '',
  totalTokens: 0,
}

// resolver.ts's maybeCompactContext() is the normal path: it summarizes
// annotationHistory via an LLM call once it estimates ~64k tokens (~256k
// chars at CHARS_PER_TOKEN=4). But that call can fail (bad key, network
// error, non-ok response) and is swallowed silently, leaving history to grow
// unbounded — the same unbounded-persisted-string risk sibling stores
// (changesStore's partialize caps, annotationStore's MAX_PERSISTED_ANNOTATIONS,
// see #64) were already hardened against. These are the hard backstop for
// when the soft LLM path fails, sized comfortably above the ~256k-char soft
// trigger so normal compaction is always the one that fires first.
const MAX_PERSISTED_HISTORY_CHARS = 400_000
const EMERGENCY_HISTORY_CHARS = 80_000

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      context: { ...initialContext },
      updateContext: (patch) =>
        set((s) => ({ context: { ...s.context, ...patch } })),
      appendToHistory: (entry) =>
        set((s) => ({
          context: {
            ...s.context,
            annotationHistory: s.context.annotationHistory
              ? `${s.context.annotationHistory}\n${entry}`
              : entry,
          },
        })),
      reset: () => set({ context: { ...initialContext } }),
    }),
    {
      name: 'intent-ide-session',
      partialize: (state) => ({
        context: {
          ...state.context,
          annotationHistory: state.context.annotationHistory.slice(-MAX_PERSISTED_HISTORY_CHARS),
        },
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
              const inner = (parsed.state ?? parsed) as { context?: SessionContext }
              if (inner.context) {
                inner.context = {
                  ...inner.context,
                  annotationHistory: (inner.context.annotationHistory ?? '').slice(-EMERGENCY_HISTORY_CHARS),
                }
              }
              localStorage.setItem(name, JSON.stringify(parsed))
            } catch {
              // Silently fail — in-memory state is still valid.
            }
          }
        },
        removeItem: (name: string) => localStorage.removeItem(name),
      },
    }
  )
)
