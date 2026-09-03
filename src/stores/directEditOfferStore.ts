'use client'

import { create } from 'zustand'
import type { DirectEditOffer, RenameOffer } from '@/lib/annotations/directEditTrigger'

/**
 * The current direct-edit cascade OFFER (Flow v1 P4) — the quiet chip's state.
 * Unpersisted on purpose: an offer is only meaningful against the live doc.
 */
interface DirectEditOfferState {
  offer: DirectEditOffer | null
  /**
   * A rename the reader made that still stands elsewhere. Independent of
   * `offer` — a rename produces no graph edge, so the two arms find different
   * things and either can fire without the other.
   */
  renameOffer: RenameOffer | null
  /** True while the user-consented cascade call is in flight. */
  running: boolean
  setOffer: (offer: DirectEditOffer) => void
  clearOffer: () => void
  setRenameOffer: (offer: RenameOffer) => void
  clearRenameOffer: () => void
  setRunning: (running: boolean) => void
}

export const useDirectEditOfferStore = create<DirectEditOfferState>()((set) => ({
  offer: null,
  renameOffer: null,
  running: false,
  setOffer: (offer) => set({ offer }),
  clearOffer: () => set({ offer: null }),
  setRenameOffer: (renameOffer) => set({ renameOffer }),
  clearRenameOffer: () => set({ renameOffer: null }),
  setRunning: (running) => set({ running }),
}))
