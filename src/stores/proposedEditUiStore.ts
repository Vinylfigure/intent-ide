import { create } from 'zustand'

/**
 * UI-only state for the inline proposed-edit Accept/Reject control.
 * Positions live in the ProseMirror plugin (transaction-mapped anchors), so this
 * store only tracks which edit is hovered / click-pinned — mirroring conflictStore
 * but without a conflict array.
 */
interface ProposedEditUiState {
  hoveredId: string | null
  /** The proposed edit currently showing the action control (click-pinned). */
  activeId: string | null
  setHovered: (id: string | null) => void
  setActive: (id: string | null) => void
  clear: () => void
}

export const useProposedEditUiStore = create<ProposedEditUiState>((set) => ({
  hoveredId: null,
  activeId: null,
  setHovered: (id) => set({ hoveredId: id }),
  setActive: (id) => set({ activeId: id }),
  clear: () => set({ hoveredId: null, activeId: null }),
}))
