import { describe, it, expect } from 'vitest'
import {
  computeFloatingPosition,
  isAnchorOnScreen,
  DEFAULT_MARGIN,
  DEFAULT_GAP,
} from '../floatingPosition'

const VIEWPORT = { width: 1440, height: 900 }
const PANEL = { width: 380, height: 320 }

/** Passage sitting in a centred column with room on both sides. */
const CENTRE_ANCHOR = { top: 200, bottom: 240, left: 500, right: 900 }

describe('computeFloatingPosition', () => {
  it('prefers the right of the passage when there is room', () => {
    const pos = computeFloatingPosition({ anchor: CENTRE_ANCHOR, panel: PANEL, viewport: VIEWPORT })
    expect(pos.side).toBe('right')
    expect(pos.left).toBe(CENTRE_ANCHOR.right + DEFAULT_GAP)
    expect(pos.top).toBe(CENTRE_ANCHOR.top)
  })

  it('falls back to the left when the right edge is too close', () => {
    const anchor = { top: 200, bottom: 240, left: 600, right: 1200 }
    const pos = computeFloatingPosition({ anchor, panel: PANEL, viewport: VIEWPORT })
    expect(pos.side).toBe('left')
    expect(pos.left).toBe(anchor.left - DEFAULT_GAP - PANEL.width)
  })

  it('drops below the passage when neither side fits', () => {
    const narrow = { width: 700, height: 900 }
    const anchor = { top: 100, bottom: 140, left: 150, right: 550 }
    const pos = computeFloatingPosition({ anchor, panel: PANEL, viewport: narrow })
    expect(pos.side).toBe('below')
    expect(pos.top).toBe(anchor.bottom + DEFAULT_GAP)
    // Centred on the passage: 150 + 400/2 - 380/2 = 160.
    expect(pos.left).toBe(160)
  })

  it('never lets the panel leave the viewport, even when centring would', () => {
    const narrow = { width: 420, height: 900 }
    const anchor = { top: 100, bottom: 140, left: 0, right: 40 }
    const pos = computeFloatingPosition({ anchor, panel: PANEL, viewport: narrow })
    expect(pos.left).toBeGreaterThanOrEqual(DEFAULT_MARGIN)
    expect(pos.left + PANEL.width).toBeLessThanOrEqual(narrow.width - DEFAULT_MARGIN)
  })

  it('pulls a panel that would overflow the bottom back into view', () => {
    const anchor = { top: 850, bottom: 880, left: 400, right: 700 }
    const pos = computeFloatingPosition({ anchor, panel: PANEL, viewport: VIEWPORT })
    expect(pos.top).toBe(VIEWPORT.height - PANEL.height - DEFAULT_MARGIN)
  })

  it('clamps to the top margin when the panel is taller than the viewport', () => {
    const tall = { width: 380, height: 2000 }
    const pos = computeFloatingPosition({ anchor: CENTRE_ANCHOR, panel: tall, viewport: VIEWPORT })
    // Vertically there is nowhere to go but the top margin; horizontally the
    // panel still fits beside the passage, so the side choice is untouched.
    expect(pos.top).toBe(DEFAULT_MARGIN)
    expect(pos.left).toBe(CENTRE_ANCHOR.right + DEFAULT_GAP)
  })

  it('applies the drag offset before clamping', () => {
    const pos = computeFloatingPosition({
      anchor: CENTRE_ANCHOR,
      panel: PANEL,
      viewport: VIEWPORT,
      offset: { dx: -40, dy: 60 },
    })
    expect(pos.left).toBe(CENTRE_ANCHOR.right + DEFAULT_GAP - 40)
    expect(pos.top).toBe(CENTRE_ANCHOR.top + 60)
  })

  it('clamps a drag that would throw the panel off-screen', () => {
    const pos = computeFloatingPosition({
      anchor: CENTRE_ANCHOR,
      panel: PANEL,
      viewport: VIEWPORT,
      offset: { dx: 9999, dy: -9999 },
    })
    expect(pos.left).toBe(VIEWPORT.width - PANEL.width - DEFAULT_MARGIN)
    expect(pos.top).toBe(DEFAULT_MARGIN)
  })

  it('parks top-right with no anchor', () => {
    const pos = computeFloatingPosition({ anchor: null, panel: PANEL, viewport: VIEWPORT })
    expect(pos.side).toBe('fallback')
    expect(pos.left).toBe(VIEWPORT.width - PANEL.width - DEFAULT_MARGIN)
    expect(pos.top).toBe(DEFAULT_MARGIN)
  })

  it('still returns an in-bounds position when the viewport is smaller than the panel', () => {
    const tiny = { width: 200, height: 200 }
    const pos = computeFloatingPosition({ anchor: CENTRE_ANCHOR, panel: PANEL, viewport: tiny })
    expect(pos.left).toBe(DEFAULT_MARGIN)
    expect(pos.top).toBe(DEFAULT_MARGIN)
  })
})

describe('isAnchorOnScreen', () => {
  it('is false without an anchor', () => {
    expect(isAnchorOnScreen(null, VIEWPORT)).toBe(false)
  })

  it('is true for a passage inside the viewport', () => {
    expect(isAnchorOnScreen(CENTRE_ANCHOR, VIEWPORT)).toBe(true)
  })

  it('is false once the passage has scrolled above the fold', () => {
    expect(isAnchorOnScreen({ top: -200, bottom: -120, left: 500, right: 900 }, VIEWPORT)).toBe(false)
  })

  it('is false for a passage below the fold', () => {
    expect(isAnchorOnScreen({ top: 1200, bottom: 1260, left: 500, right: 900 }, VIEWPORT)).toBe(false)
  })
})
