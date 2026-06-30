import { create } from 'zustand'

export type ConflictSeverity = 'direct' | 'ambiguous'
export type ResolutionStatus = 'pending' | 'accepted' | 'rejected'

export interface ConflictFlag {
  id: string
  from: number
  to: number
  severity: ConflictSeverity
  reasoning: string
  annotationId: string | null
  /** Current resolution status for local accept/reject */
  resolution: ResolutionStatus
  /** AI-proposed replacement text, if any */
  proposedText: string | null
}

interface ConflictState {
  conflicts: ConflictFlag[]
  hoveredConflictId: string | null
  /** The conflict currently showing the action bar (click-pinned) */
  activeConflictId: string | null
  addConflict: (conflict: ConflictFlag) => void
  removeConflict: (id: string) => void
  clearAll: () => void
  setHovered: (id: string | null) => void
  setActive: (id: string | null) => void
  resolveConflict: (id: string, status: ResolutionStatus) => void
  getById: (id: string) => ConflictFlag | undefined
}

export const useConflictStore = create<ConflictState>((set, get) => ({
  conflicts: [],
  hoveredConflictId: null,
  activeConflictId: null,

  addConflict: (conflict) =>
    set((s) => ({ conflicts: [...s.conflicts, { ...conflict, resolution: conflict.resolution ?? 'pending', proposedText: conflict.proposedText ?? null }] })),

  removeConflict: (id) =>
    set((s) => ({
      conflicts: s.conflicts.filter((c) => c.id !== id),
      hoveredConflictId: s.hoveredConflictId === id ? null : s.hoveredConflictId,
      activeConflictId: s.activeConflictId === id ? null : s.activeConflictId,
    })),

  clearAll: () => set({ conflicts: [], hoveredConflictId: null, activeConflictId: null }),

  setHovered: (id) => set({ hoveredConflictId: id }),

  setActive: (id) => set({ activeConflictId: id }),

  resolveConflict: (id, status) =>
    set((s) => ({
      conflicts: s.conflicts.map((c) =>
        c.id === id ? { ...c, resolution: status } : c
      ),
    })),

  getById: (id) => get().conflicts.find((c) => c.id === id),
}))
