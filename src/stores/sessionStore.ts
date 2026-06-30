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
    { name: 'intent-ide-session' }
  )
)
