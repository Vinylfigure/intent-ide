import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  recordCascadeDecision,
  recordCascadeStatusChange,
  CASCADE_CALIBRATION_EVENT,
  type CascadeDecisionEvent,
  type ReviewedEditLike,
} from '../cascadeCalibration'
import {
  useCascadeCalibrationStore,
  emptyCalibrationCounts,
} from '@/stores/cascadeCalibrationStore'
import { useSettingsStore } from '@/stores/settingsStore'

const CASCADE_EVENT: CascadeDecisionEvent = {
  severity: 'must',
  edgeType: 'references',
  relation: 'cascade',
  action: 'accepted',
  source: 'inline',
}

function pendingEdit(overrides: Partial<ReviewedEditLike> = {}): ReviewedEditLike {
  return {
    relation: 'cascade',
    severity: 'probably',
    evidence: { sourceBlockId: 'b1', quotedText: '$50,000', edgeType: 'references' },
    status: 'pending',
    ...overrides,
  }
}

beforeEach(() => {
  useCascadeCalibrationStore.getState().reset()
  useSettingsStore.setState({ telemetryEnabled: false })
})

describe('recordCascadeDecision — local aggregate sink', () => {
  it('always records cascade decisions into the local aggregate', () => {
    recordCascadeDecision(CASCADE_EVENT)
    recordCascadeDecision({ ...CASCADE_EVENT, action: 'applied', source: 'modal' })
    const counts = useCascadeCalibrationStore.getState().counts
    expect(counts.must.accepted).toBe(1)
    expect(counts.must.applied).toBe(1)
  })

  it('drops primary-relation events entirely (no calibration signal)', () => {
    const capture = vi.fn()
    recordCascadeDecision(
      { ...CASCADE_EVENT, relation: 'primary' },
      { telemetryEnabled: true, capture },
    )
    expect(useCascadeCalibrationStore.getState().counts.must.accepted).toBe(0)
    expect(capture).not.toHaveBeenCalled()
  })
})

describe('recordCascadeDecision — remote capture gating', () => {
  it('does NOT capture when telemetryEnabled is false (the default)', () => {
    const capture = vi.fn()
    recordCascadeDecision(CASCADE_EVENT, { capture })
    // Settings default is false — no deps override needed.
    expect(useSettingsStore.getState().telemetryEnabled).toBe(false)
    expect(capture).not.toHaveBeenCalled()
    // Local aggregate still recorded.
    expect(useCascadeCalibrationStore.getState().counts.must.accepted).toBe(1)
  })

  it('captures when telemetryEnabled is true', () => {
    const capture = vi.fn()
    recordCascadeDecision(CASCADE_EVENT, { telemetryEnabled: true, capture })
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith(CASCADE_CALIBRATION_EVENT, {
      severity: 'must',
      edgeType: 'references',
      relation: 'cascade',
      action: 'accepted',
      source: 'inline',
    })
  })

  it('reads the settings-store flag when no override is given', () => {
    const capture = vi.fn()
    useSettingsStore.setState({ telemetryEnabled: true })
    recordCascadeDecision(CASCADE_EVENT, { capture })
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('payload contains ONLY closed-enum metadata — no text, no ids', () => {
    const capture = vi.fn()
    recordCascadeDecision(CASCADE_EVENT, { telemetryEnabled: true, capture })
    const [, payload] = capture.mock.calls[0] as [string, Record<string, unknown>]
    expect(Object.keys(payload).sort()).toEqual([
      'action',
      'edgeType',
      'relation',
      'severity',
      'source',
    ])
    const ALLOWED = new Set([
      'must', 'probably', 'optional',
      'defines', 'references', 'depends-on', 'implements', 'tests', 'contradicts', 'duplicates',
      'cascade', 'primary',
      'accepted', 'rejected', 'applied',
      'inline', 'list', 'modal',
      null,
    ])
    for (const value of Object.values(payload)) {
      expect(ALLOWED.has(value as string | null)).toBe(true)
    }
  })

  // Compile-time shape lock: adding a text/id-bearing field to the event type
  // must force this literal (and therefore this test file) to be revisited.
  it('event type is exactly {severity, edgeType, relation, action, source}', () => {
    const exhaustive: Record<keyof CascadeDecisionEvent, true> = {
      severity: true,
      edgeType: true,
      relation: true,
      action: true,
      source: true,
    }
    expect(Object.keys(exhaustive)).toHaveLength(5)
  })

  it('a throwing capture sink never propagates (fire and forget)', () => {
    expect(() =>
      recordCascadeDecision(CASCADE_EVENT, {
        telemetryEnabled: true,
        capture: () => {
          throw new Error('posthog exploded')
        },
      }),
    ).not.toThrow()
    // The local aggregate was still written before the sink threw.
    expect(useCascadeCalibrationStore.getState().counts.must.accepted).toBe(1)
  })
})

describe('recordCascadeStatusChange — status-change-only guard', () => {
  it('records when the status actually changes', () => {
    recordCascadeStatusChange(pendingEdit(), 'accepted', 'list')
    expect(useCascadeCalibrationStore.getState().counts.probably.accepted).toBe(1)
  })

  it('does NOT record when the new status equals the current status', () => {
    recordCascadeStatusChange(pendingEdit({ status: 'accepted' }), 'accepted', 'inline')
    recordCascadeStatusChange(pendingEdit({ status: 'rejected' }), 'rejected', 'modal')
    expect(useCascadeCalibrationStore.getState().counts).toEqual(emptyCalibrationCounts())
  })

  it('records a flip from accepted to rejected (a real decision change)', () => {
    recordCascadeStatusChange(pendingEdit({ status: 'accepted' }), 'rejected', 'modal')
    expect(useCascadeCalibrationStore.getState().counts.probably.rejected).toBe(1)
  })

  it('ignores primary edits and uses evidence edge type for cascades', () => {
    const capture = vi.fn()
    recordCascadeStatusChange(pendingEdit({ relation: 'primary' }), 'accepted', 'inline', {
      telemetryEnabled: true,
      capture,
    })
    expect(capture).not.toHaveBeenCalled()

    recordCascadeStatusChange(pendingEdit({ evidence: null }), 'accepted', 'inline', {
      telemetryEnabled: true,
      capture,
    })
    expect(capture).toHaveBeenCalledWith(
      CASCADE_CALIBRATION_EVENT,
      expect.objectContaining({ edgeType: null }),
    )
  })
})
