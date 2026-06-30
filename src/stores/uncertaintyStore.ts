import { create } from 'zustand'

export interface TokenAlternative {
  token: string
  probability: number
}

export interface UncertainToken {
  id: string
  from: number
  to: number
  /** Edit-model probability: likelihood a human will need to modify this token (0–1) */
  editProbability: number
  /** The original token text */
  originalToken: string
  /** Top alternative tokens from logprobs (sorted by probability, descending) */
  alternatives: TokenAlternative[]
}

interface UncertaintyState {
  tokens: UncertainToken[]
  enabled: boolean
  /** ID of the uncertainty token currently being hovered */
  hoveredTokenId: string | null
  /** ID of the uncertainty token pinned open by clicking */
  activeTokenId: string | null
  addTokens: (tokens: UncertainToken[]) => void
  removeToken: (id: string) => void
  clearAll: () => void
  setEnabled: (enabled: boolean) => void
  setHovered: (id: string | null) => void
  setActive: (id: string | null) => void
}

export const useUncertaintyStore = create<UncertaintyState>((set) => ({
  tokens: [],
  enabled: true,
  hoveredTokenId: null,
  activeTokenId: null,

  addTokens: (tokens) =>
    set((s) => ({ tokens: [...s.tokens, ...tokens] })),

  removeToken: (id) =>
    set((s) => ({
      tokens: s.tokens.filter((t) => t.id !== id),
      hoveredTokenId: s.hoveredTokenId === id ? null : s.hoveredTokenId,
      activeTokenId: s.activeTokenId === id ? null : s.activeTokenId,
    })),

  clearAll: () => set({ tokens: [], hoveredTokenId: null, activeTokenId: null }),

  setEnabled: (enabled) => set({ enabled }),
  setHovered: (id) => set({ hoveredTokenId: id }),
  setActive: (id) => set({ activeTokenId: id }),
}))
