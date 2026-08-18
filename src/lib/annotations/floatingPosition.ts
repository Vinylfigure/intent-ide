/**
 * Placement maths for the floating answer panel.
 *
 * Kept free of React and the DOM so the clamping rules — the part that
 * actually goes wrong — are unit-testable. The component supplies measured
 * rects; this module only decides where the panel lands.
 */

/** Viewport-relative rect of the annotated passage (as ProseMirror reports it). */
export interface AnchorRect {
  top: number
  bottom: number
  left: number
  right: number
}

export interface PanelSize {
  width: number
  height: number
}

export interface ViewportSize {
  width: number
  height: number
}

/** User drag offset, applied after the automatic side choice. */
export interface DragOffset {
  dx: number
  dy: number
}

export type FloatingSide = 'right' | 'left' | 'below' | 'fallback'

export interface FloatingPosition {
  left: number
  top: number
  /** Which rule produced the position — surfaced for the caret/aria hints. */
  side: FloatingSide
}

export interface FloatingPositionInput {
  /** Null when the anchor is off-screen or ProseMirror cannot resolve it. */
  anchor: AnchorRect | null
  panel: PanelSize
  viewport: ViewportSize
  offset?: DragOffset
  /** Minimum distance from any viewport edge. */
  margin?: number
  /** Gap between the anchor and the panel. */
  gap?: number
}

export const DEFAULT_MARGIN = 12
export const DEFAULT_GAP = 16

/** Clamp `value` into [min, max], preferring `min` when the range is inverted. */
function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

/**
 * Choose a resting place for the floating answer panel.
 *
 * Preference order: right of the passage, then left, then below it. Whatever
 * the choice, the result is always clamped fully inside the viewport — a
 * panel the user cannot reach is worse than one that overlaps the text.
 */
export function computeFloatingPosition({
  anchor,
  panel,
  viewport,
  offset = { dx: 0, dy: 0 },
  margin = DEFAULT_MARGIN,
  gap = DEFAULT_GAP,
}: FloatingPositionInput): FloatingPosition {
  const maxLeft = viewport.width - panel.width - margin
  const maxTop = viewport.height - panel.height - margin

  // No usable anchor: park the panel top-right and let the user drag it.
  if (!anchor) {
    return {
      left: clamp(maxLeft + offset.dx, margin, maxLeft),
      top: clamp(margin + offset.dy, margin, maxTop),
      side: 'fallback',
    }
  }

  let side: FloatingSide
  let left: number

  if (anchor.right + gap + panel.width <= viewport.width - margin) {
    side = 'right'
    left = anchor.right + gap
  } else if (anchor.left - gap - panel.width >= margin) {
    side = 'left'
    left = anchor.left - gap - panel.width
  } else {
    side = 'below'
    // Centre on the passage horizontally; the clamp below pulls it in.
    left = anchor.left + (anchor.right - anchor.left) / 2 - panel.width / 2
  }

  // Vertically: top-align with the passage when beside it, drop below it
  // otherwise. Nudge up if that would run off the bottom.
  const top = side === 'below' ? anchor.bottom + gap : anchor.top

  return {
    left: clamp(left + offset.dx, margin, maxLeft),
    top: clamp(top + offset.dy, margin, maxTop),
    side,
  }
}

/**
 * Whether the anchor is visible enough to be worth pointing at. An anchor
 * scrolled out of the viewport gets no arrow and no side preference — the
 * panel falls back to its parked position instead of chasing off-screen
 * coordinates.
 */
export function isAnchorOnScreen(anchor: AnchorRect | null, viewport: ViewportSize): boolean {
  if (!anchor) return false
  return anchor.bottom > 0 && anchor.top < viewport.height && anchor.right > 0 && anchor.left < viewport.width
}
