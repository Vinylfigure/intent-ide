import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createModalDecisionBuffer, type BufferedEditMeta } from '../modalDecisionBuffer'
import {
  useCascadeCalibrationStore,
  emptyCalibrationCounts,
} from '@/stores/cascadeCalibrationStore'
import { useSettingsStore } from '@/stores/settingsStore'
import type { ProposedEditStatus } from '@/lib/annotations/types'

const CASCADE_META: BufferedEditMeta = {
  relation: 'cascade',
  severity: 'must',
  evidence: { sourceBlockId: 'b1', quotedText: '$50,000', edgeType: 'references' },
}

function buffer(
  metas: Record<string, BufferedEditMeta>,
  openStatuses: Record<string, ProposedEditStatus> = {},
) {
  return createModalDecisionBuffer(
    new Map(Object.entries(metas)),
    new Map(Object.entries(openStatuses)),
  )
}

beforeEach(() => {
  useCascadeCalibrationStore.getState().reset()
  useSettingsStore.setState({ telemetryEnabled: false })
})

describe('createModalDecisionBuffer', () => {
  it('cancel discards everything — an abandoned review records nothing', () => {
    const buf = buffer({ e1: CASCADE_META, e2: CASCADE_META })
    buf.toggle('e1', 'rejected')
    buf.toggle('e2', 'accepted')
    buf.cancel()
    expect(useCascadeCalibrationStore.getState().counts).toEqual(emptyCalibrationCounts())
    // A confirm AFTER cancel also flushes nothing (buffer was cleared).
    buf.confirm()
    expect(useCascadeCalibrationStore.getState().counts).toEqual(emptyCalibrationCounts())
  })

  it('confirm flushes ONE event per edit — last decision wins, flip inflation gone', () => {
    const capture = vi.fn()
    const buf = buffer({ e1: CASCADE_META, e2: { ...CASCADE_META, severity: 'probably' } })
    // Flip e1 back and forth: only the final 'rejected' may count.
    buf.toggle('e1', 'accepted')
    buf.toggle('e1', 'rejected')
    buf.toggle('e1', 'accepted')
    buf.toggle('e1', 'rejected')
    buf.toggle('e2', 'accepted')
    buf.confirm({ telemetryEnabled: true, capture })

    const counts = useCascadeCalibrationStore.getState().counts
    expect(counts.must.rejected).toBe(1)
    expect(counts.must.accepted).toBe(0) // the intermediate flips never landed
    expect(counts.probably.accepted).toBe(1)
    expect(capture).toHaveBeenCalledTimes(2)
    expect(capture).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ action: 'rejected', severity: 'must', source: 'modal' }),
    )
  })

  it('a decision ending at the modal-OPEN-time status flushes nothing (status-change guard)', () => {
    const buf = buffer({ e1: CASCADE_META }, { e1: 'accepted' })
    buf.toggle('e1', 'rejected')
    buf.toggle('e1', 'accepted') // back where the review started
    buf.confirm()
    expect(useCascadeCalibrationStore.getState().counts).toEqual(emptyCalibrationCounts())
  })

  it('guards against the OPEN-time status, not pending: open-rejected → accepted records', () => {
    const buf = buffer({ e1: CASCADE_META }, { e1: 'rejected' })
    buf.toggle('e1', 'accepted')
    buf.confirm()
    expect(useCascadeCalibrationStore.getState().counts.must.accepted).toBe(1)
  })

  it('confirm clears the buffer — a second confirm records nothing more', () => {
    const buf = buffer({ e1: CASCADE_META })
    buf.toggle('e1', 'accepted')
    buf.confirm()
    buf.confirm()
    expect(useCascadeCalibrationStore.getState().counts.must.accepted).toBe(1)
  })

  it('ignores ids outside the review set (single-edit fallback rows)', () => {
    const buf = buffer({ e1: CASCADE_META })
    buf.toggle('annotation-id-not-an-edit', 'accepted')
    buf.confirm()
    expect(useCascadeCalibrationStore.getState().counts).toEqual(emptyCalibrationCounts())
  })

  it('primary-relation edits flush no calibration events (no signal)', () => {
    const buf = buffer({
      prim: { ...CASCADE_META, relation: 'primary' },
      casc: CASCADE_META,
    })
    buf.toggle('prim', 'rejected')
    buf.toggle('casc', 'rejected')
    buf.confirm()
    const counts = useCascadeCalibrationStore.getState().counts
    expect(counts.must.rejected).toBe(1) // only the cascade counted
  })
})
