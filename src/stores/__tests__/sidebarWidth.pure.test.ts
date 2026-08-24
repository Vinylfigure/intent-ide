import { describe, expect, it } from 'vitest'
import {
  clampSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from '../layoutStore'

describe('clampSidebarWidth', () => {
  it('passes through in-range widths, rounded to whole pixels', () => {
    expect(clampSidebarWidth(320)).toBe(320)
    expect(clampSidebarWidth(419.6)).toBe(420)
  })

  it('clamps below the minimum and above the maximum', () => {
    expect(clampSidebarWidth(0)).toBe(SIDEBAR_MIN_WIDTH)
    expect(clampSidebarWidth(-50)).toBe(SIDEBAR_MIN_WIDTH)
    expect(clampSidebarWidth(10_000)).toBe(SIDEBAR_MAX_WIDTH)
  })

  it('falls back to the default for non-numeric or non-finite values', () => {
    expect(clampSidebarWidth(undefined)).toBe(SIDEBAR_DEFAULT_WIDTH)
    expect(clampSidebarWidth(null)).toBe(SIDEBAR_DEFAULT_WIDTH)
    expect(clampSidebarWidth('340')).toBe(SIDEBAR_DEFAULT_WIDTH)
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_WIDTH)
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_DEFAULT_WIDTH)
  })
})
