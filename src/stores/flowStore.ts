'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Flow-state presentation preferences + the transient set of held answers.
 *
 * Only `bufferAnswersEnabled` persists (key `intent-ide-flow`); `heldAnswers`
 * is session-scratch — a page reload must never resurrect a hold, or an
 * answer could be suppressed with no live poll to release it.
 */
export interface HeldAnswer {
  /** Timestamp the answer was held (Date.now()). */
  heldAt: number
  /** Dwell fallback for this hold (see answerDwellMs). */
  dwellMs: number
}

interface FlowState {
  /** Buffer ask/dig answers until a reading breakpoint (default on). */
  bufferAnswersEnabled: boolean
  /** Annotation id → hold record. Unpersisted. */
  heldAnswers: Record<string, HeldAnswer>
  holdAnswer: (id: string, dwellMs: number) => void
  revealAnswer: (id: string) => void
  /** Drops every held answer at once — for a bulk annotation wipe (e.g. `useAnnotationStore.clear()`), where no single id is being "revealed". */
  clearHeldAnswers: () => void
  setBufferAnswersEnabled: (enabled: boolean) => void
}

export const useFlowStore = create<FlowState>()(
  persist(
    (set) => ({
      bufferAnswersEnabled: true,
      heldAnswers: {},
      holdAnswer: (id, dwellMs) =>
        set((s) => ({
          heldAnswers: { ...s.heldAnswers, [id]: { heldAt: Date.now(), dwellMs } },
        })),
      revealAnswer: (id) =>
        set((s) => {
          if (!(id in s.heldAnswers)) return s
          const next = { ...s.heldAnswers }
          delete next[id]
          return { heldAnswers: next }
        }),
      clearHeldAnswers: () => set({ heldAnswers: {} }),
      setBufferAnswersEnabled: (enabled) => set({ bufferAnswersEnabled: enabled }),
    }),
    {
      name: 'intent-ide-flow',
      partialize: (s) => ({ bufferAnswersEnabled: s.bufferAnswersEnabled }),
      onRehydrateStorage: () => (state) => {
        // Backfill corrupt/legacy persisted values to the default (on).
        if (state && typeof state.bufferAnswersEnabled !== 'boolean') {
          state.bufferAnswersEnabled = true
        }
      },
    },
  ),
)
