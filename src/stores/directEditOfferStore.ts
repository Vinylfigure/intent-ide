'use client'

import { create } from 'zustand'
import type { DirectEditOffer } from '@/lib/annotations/directEditTrigger'

/**
 * The current direct-edit cascade OFFER (Flow v1 P4) — the quiet chip's state.
 * Unpersisted on purpose: an offer is only meaningful against the live doc.
 */
interface DirectEditOfferState {
  offer: DirectEditOffer | null
  /** True while the user-consented cascade call is in flight. */
  running: boolean
  setOffer: (offer: DirectEditOffer) => void
  clearOffer: () => void
  setRunning: (running: boolean) => void
}

export const useDirectEditOfferStore = create<DirectEditOfferState>()((set) => ({
  offer: null,
  running: false,
  setOffer: (offer) => set({ offer }),
  clearOffer: () => set({ offer: null }),
  setRunning: (running) => set({ running }),
}))
