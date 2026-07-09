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
  /** Highest publish seq applied so far — stale (lower-seq) publishes are ignored. */
  lastSeq: number
  /**
   * Compare-and-set publish: ignores any publish whose seq is below the
   * highest already applied, so an older build's late 'building'/'ready'
   * can neither churn the chip nor overwrite a fresher graph.
   */
  publish: (seq: number, status: DocGraphStatus, graph?: DocGraph) => void
  setGraph: (graph: DocGraph | null) => void
  setStatus: (status: DocGraphStatus) => void
}

export const useDocGraphStore = create<DocGraphState>()((set) => ({
  graph: null,
  status: 'idle',
  lastSeq: 0,
  publish: (seq, status, graph) =>
    set((s) => {
      if (seq < s.lastSeq) return s
      return { lastSeq: seq, status, ...(graph !== undefined ? { graph } : {}) }
    }),
  setGraph: (graph) => set({ graph }),
  setStatus: (status) => set({ status }),
}))
