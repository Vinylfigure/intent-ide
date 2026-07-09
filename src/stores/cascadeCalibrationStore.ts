'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CascadeSeverity } from '@/lib/annotations/types'

/**
 * Local severity-calibration aggregate for cascade review decisions.
 *
 * Pure counters — counts by severity × action only. NO document text, NO
 * annotation/edit ids, NO timestamps ever enter this store; it exists so the
 * settings panel can show whether the derived severities match how the user
 * actually reviews (e.g. "must" proposals being rejected half the time means
 * verification is miscalibrated). Always on: this aggregate never leaves the
 * machine. The optional PostHog sink lives in lib/telemetry and is gated
 * separately behind the telemetryEnabled setting (default off).
 */

export type CalibrationAction = 'accepted' | 'rejected' | 'applied'

export type CalibrationCounts = Record<CascadeSeverity, Record<CalibrationAction, number>>

/** Per-counter cap — keeps a years-long local aggregate bounded. */
export const CALIBRATION_COUNT_CAP = 100_000

export function emptyCalibrationCounts(): CalibrationCounts {
  return {
    must: { accepted: 0, rejected: 0, applied: 0 },
    probably: { accepted: 0, rejected: 0, applied: 0 },
    optional: { accepted: 0, rejected: 0, applied: 0 },
  }
}

/** Backfill/clamp a possibly-partial persisted shape (older builds, tampering). */
function normalizeCounts(raw: unknown): CalibrationCounts {
  const counts = emptyCalibrationCounts()
  if (!raw || typeof raw !== 'object') return counts
  for (const severity of Object.keys(counts) as CascadeSeverity[]) {
    const row = (raw as Record<string, unknown>)[severity]
    if (!row || typeof row !== 'object') continue
    for (const action of Object.keys(counts[severity]) as CalibrationAction[]) {
      const value = (row as Record<string, unknown>)[action]
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        counts[severity][action] = Math.min(Math.floor(value), CALIBRATION_COUNT_CAP)
      }
    }
  }
  return counts
}

interface CascadeCalibrationState {
  counts: CalibrationCounts
  record: (severity: CascadeSeverity, action: CalibrationAction) => void
  reset: () => void
}

export const useCascadeCalibrationStore = create<CascadeCalibrationState>()(
  persist(
    (set) => ({
      counts: emptyCalibrationCounts(),
      record: (severity, action) =>
        set((s) => {
          const current = s.counts[severity]?.[action] ?? 0
          if (current >= CALIBRATION_COUNT_CAP) return s
          return {
            counts: {
              ...s.counts,
              [severity]: { ...s.counts[severity], [action]: current + 1 },
            },
          }
        }),
      reset: () => set({ counts: emptyCalibrationCounts() }),
    }),
    {
      name: 'intent-ide-cascade-calibration',
      onRehydrateStorage: () => (state) => {
        if (!state) return
        const normalized = normalizeCounts(state.counts)
        state.counts = normalized
      },
    },
  ),
)
