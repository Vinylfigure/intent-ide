import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Dedup ledger for the Document Invariant Ledger's doc-CI lane (issue #32):
 * tracks which (document, invariant, conflicting-block) pairs have already
 * been surfaced as a flag, so an unresolved conflict doesn't re-inject a
 * duplicate annotation on every future apply.
 *
 * Deliberately its OWN store, not a derived read of `annotationStore` — the
 * annotation store is unscoped-cleared by `DocInputModal.loadDoc()` on every
 * new-document creation (a pre-existing behavior, out of scope to change
 * here), which would otherwise wipe this dedup memory for every OTHER open
 * document too, reviving stale flags. This store is untouched by that path.
 */

const MAX_SURFACED = 1000

interface InvariantFlagState {
  surfaced: string[]
  hasSurfaced: (key: string) => boolean
  markSurfaced: (key: string) => void
  clear: () => void
}

export const useInvariantFlagStore = create<InvariantFlagState>()(
  persist(
    (set, get) => ({
      surfaced: [],
      hasSurfaced: (key) => get().surfaced.includes(key),
      markSurfaced: (key) =>
        set((s) =>
          s.surfaced.includes(key)
            ? s
            : { surfaced: [...s.surfaced, key].slice(-MAX_SURFACED) },
        ),
      clear: () => set({ surfaced: [] }),
    }),
    { name: 'intent-ide-invariant-flags' },
  ),
)
