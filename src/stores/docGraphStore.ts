'use client'

import { create } from 'zustand'
import type { DocGraph } from '@/lib/graphrag/docGraph'

/**
 * UI mirror of the doc-graph build lifecycle. NOT persisted — the graph holds
 * live Maps keyed by runtime block ids and is rebuilt from the document on
 * demand. Published by getDocGraph (browser only, via lazy import) so trust
 * surfaces (StatusBar chip, "why this proposal?" edge paths) can read the
 * latest graph without triggering a build themselves.
 */

export type DocGraphStatus = 'idle' | 'building' | 'ready'

interface DocGraphState {
  graph: DocGraph | null
  status: DocGraphStatus
  setGraph: (graph: DocGraph | null) => void
  setStatus: (status: DocGraphStatus) => void
}

export const useDocGraphStore = create<DocGraphState>()((set) => ({
  graph: null,
  status: 'idle',
  setGraph: (graph) => set({ graph }),
  setStatus: (status) => set({ status }),
}))
