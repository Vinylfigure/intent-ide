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

export const SIDEBAR_MIN_WIDTH = 280
export const SIDEBAR_MAX_WIDTH = 560
export const SIDEBAR_DEFAULT_WIDTH = 320

/**
 * Map any persisted or in-flight value onto a usable sidebar width: numbers
 * clamp into [MIN, MAX] and round to whole pixels; anything else (older
 * snapshots without the field, corrupt values) falls back to the default.
 */
export function clampSidebarWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SIDEBAR_DEFAULT_WIDTH
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)))
}

/** Map a possibly-stale/corrupt persisted value onto a usable id list. */
export function normalizeCollapsedAnnotationIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((id): id is string => typeof id === 'string')
}

interface LayoutState {
  answerPlacement: AnswerPlacement
  /** Width of the left sidebar rail in pixels, drag-resizable and persisted. */
  sidebarWidth: number
  /**
   * Manual drag offset for the floating panel, in pixels from its computed
   * resting place. Session-scratch on purpose: a persisted offset taken from
   * a different window size would strand the panel somewhere it no longer
   * makes sense, and the automatic placement is the better default on load.
   */
  floatingOffset: { dx: number; dy: number }
  /**
   * Annotation ids collapsed to their header line in the Annotations panel.
   * A view preference, not annotation state — deliberately lives here
   * rather than on `Annotation.hidden` or any other annotation field, and
   * is persisted so a reload doesn't silently re-expand every thread.
   */
  collapsedAnnotationIds: string[]
  setAnswerPlacement: (placement: AnswerPlacement) => void
  setSidebarWidth: (width: number) => void
  toggleAnswerPlacement: () => void
  setFloatingOffset: (offset: { dx: number; dy: number }) => void
  resetFloatingOffset: () => void
  toggleAnnotationCollapsed: (id: string) => void
  setAnnotationCollapsed: (id: string, collapsed: boolean) => void
}

export const ZERO_OFFSET = { dx: 0, dy: 0 }

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      answerPlacement: 'sidebar',
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      floatingOffset: ZERO_OFFSET,
      collapsedAnnotationIds: [],
      // Changing placement always re-parks the panel: the offset was chosen
      // against the old layout and means nothing in the new one.
      setAnswerPlacement: (placement) =>
        set({ answerPlacement: normalizeAnswerPlacement(placement), floatingOffset: ZERO_OFFSET }),
      toggleAnswerPlacement: () =>
        set((s) => ({
          answerPlacement: s.answerPlacement === 'sidebar' ? 'floating' : 'sidebar',
          floatingOffset: ZERO_OFFSET,
        })),
      setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),
      setFloatingOffset: (offset) => set({ floatingOffset: offset }),
      resetFloatingOffset: () => set({ floatingOffset: ZERO_OFFSET }),
      toggleAnnotationCollapsed: (id) =>
        set((s) => ({
          collapsedAnnotationIds: s.collapsedAnnotationIds.includes(id)
            ? s.collapsedAnnotationIds.filter((x) => x !== id)
            : [...s.collapsedAnnotationIds, id],
        })),
      setAnnotationCollapsed: (id, collapsed) =>
        set((s) => ({
          collapsedAnnotationIds: collapsed
            ? s.collapsedAnnotationIds.includes(id)
              ? s.collapsedAnnotationIds
              : [...s.collapsedAnnotationIds, id]
            : s.collapsedAnnotationIds.filter((x) => x !== id),
        })),
    }),
    {
      name: 'intent-ide-layout',
      partialize: (s) => ({
        answerPlacement: s.answerPlacement,
        sidebarWidth: s.sidebarWidth,
        collapsedAnnotationIds: s.collapsedAnnotationIds,
      }),
      onRehydrateStorage: () => (state) => {
        // A snapshot from an older build may carry a placement this one has
        // never heard of; fall back to the sidebar rather than render nothing.
        if (state) {
          state.answerPlacement = normalizeAnswerPlacement(state.answerPlacement)
          state.sidebarWidth = clampSidebarWidth(state.sidebarWidth)
          state.floatingOffset = ZERO_OFFSET
          state.collapsedAnnotationIds = normalizeCollapsedAnnotationIds(state.collapsedAnnotationIds)
        }
      },
    },
  ),
)
