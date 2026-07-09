import { describe, it, expect, beforeEach } from 'vitest'
import {
  useCascadeCalibrationStore,
  emptyCalibrationCounts,
  CALIBRATION_COUNT_CAP,
} from '../cascadeCalibrationStore'

beforeEach(() => {
  useCascadeCalibrationStore.getState().reset()
})

describe('cascadeCalibrationStore', () => {
  it('starts with all-zero counts for every severity × action', () => {
    expect(useCascadeCalibrationStore.getState().counts).toEqual(emptyCalibrationCounts())
  })

  it('record() increments exactly one severity × action counter', () => {
    const { record } = useCascadeCalibrationStore.getState()
    record('must', 'accepted')
    record('must', 'accepted')
    record('must', 'rejected')
    record('probably', 'applied')

    const counts = useCascadeCalibrationStore.getState().counts
    expect(counts.must).toEqual({ accepted: 2, rejected: 1, applied: 0 })
    expect(counts.probably).toEqual({ accepted: 0, rejected: 0, applied: 1 })
    expect(counts.optional).toEqual({ accepted: 0, rejected: 0, applied: 0 })
  })

  it('caps each counter at CALIBRATION_COUNT_CAP', () => {
    useCascadeCalibrationStore.setState((s) => ({
      counts: {
        ...s.counts,
        optional: { ...s.counts.optional, rejected: CALIBRATION_COUNT_CAP },
      },
    }))
    useCascadeCalibrationStore.getState().record('optional', 'rejected')
    expect(useCascadeCalibrationStore.getState().counts.optional.rejected).toBe(
      CALIBRATION_COUNT_CAP,
    )
  })

  it('reset() zeroes everything', () => {
    const { record, reset } = useCascadeCalibrationStore.getState()
    record('must', 'accepted')
    record('optional', 'rejected')
    reset()
    expect(useCascadeCalibrationStore.getState().counts).toEqual(emptyCalibrationCounts())
  })
})
