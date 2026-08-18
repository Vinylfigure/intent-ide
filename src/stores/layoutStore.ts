'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Where a resolved annotation's answer is presented.
 *
 * `sidebar` — the original behaviour: the card expands in place in the
 *   Annotations panel.
 * `floating` — the card detaches into a panel anchored beside the passage it
 *   belongs to, so the answer sits next to the text it is about rather than
 *   across the window. The sidebar keeps a compact index of the same threads.
 */
export type AnswerPlacement = 'sidebar' | 'floating'

export const ANSWER_PLACEMENTS: AnswerPlacement[] = ['sidebar', 'floating']

const VALID_PLACEMENTS = new Set<string>(ANSWER_PLACEMENTS)

/** Map a possibly-stale persisted value onto a placement this build knows. */
export function normalizeAnswerPlacement(value: unknown): AnswerPlacement {
  return typeof value === 'string' && VALID_PLACEMENTS.has(value)
    ? (value as AnswerPlacement)
    : 'sidebar'
}

interface LayoutState {
  answerPlacement: AnswerPlacement
  /**
   * Manual drag offset for the floating panel, in pixels from its computed
   * resting place. Session-scratch on purpose: a persisted offset taken from
   * a different window size would strand the panel somewhere it no longer
   * makes sense, and the automatic placement is the better default on load.
   */
  floatingOffset: { dx: number; dy: number }
  setAnswerPlacement: (placement: AnswerPlacement) => void
  toggleAnswerPlacement: () => void
  setFloatingOffset: (offset: { dx: number; dy: number }) => void
  resetFloatingOffset: () => void
}

export const ZERO_OFFSET = { dx: 0, dy: 0 }

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      answerPlacement: 'sidebar',
      floatingOffset: ZERO_OFFSET,
      // Changing placement always re-parks the panel: the offset was chosen
      // against the old layout and means nothing in the new one.
      setAnswerPlacement: (placement) =>
        set({ answerPlacement: normalizeAnswerPlacement(placement), floatingOffset: ZERO_OFFSET }),
      toggleAnswerPlacement: () =>
        set((s) => ({
          answerPlacement: s.answerPlacement === 'sidebar' ? 'floating' : 'sidebar',
          floatingOffset: ZERO_OFFSET,
        })),
      setFloatingOffset: (offset) => set({ floatingOffset: offset }),
      resetFloatingOffset: () => set({ floatingOffset: ZERO_OFFSET }),
    }),
    {
      name: 'intent-ide-layout',
      partialize: (s) => ({ answerPlacement: s.answerPlacement }),
      onRehydrateStorage: () => (state) => {
        // A snapshot from an older build may carry a placement this one has
        // never heard of; fall back to the sidebar rather than render nothing.
        if (state) {
          state.answerPlacement = normalizeAnswerPlacement(state.answerPlacement)
          state.floatingOffset = ZERO_OFFSET
        }
      },
    },
  ),
)
