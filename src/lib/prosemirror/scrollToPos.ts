import type { EditorView } from 'prosemirror-view'

/**
 * Scroll the editor so a document position sits near the top of the reading
 * area.
 *
 * Extracted because there were already two copies of this — `AnnotationMap`'s
 * `scrollToPos` and `CascadeList`'s `scrollToEdit` — differing only in that one
 * of them guarded `coordsAtPos` against a position invalidated by a concurrent
 * document change and the other did not. Adding a third caller (the related-
 * passage links on the resolution card) meant either a third copy or one
 * shared function; two copies of a scroll offset had already drifted once.
 *
 * Fails silently and completely: a scroll that cannot happen must never take
 * down the click handler that asked for it.
 */

/** Distance from the top of the scroll container to leave above the target. */
const TOP_MARGIN_PX = 100

export function scrollToPos(view: EditorView | null | undefined, pos: number): void {
  if (!view) return
  // A stored position can outlive the text it pointed at.
  const safePos = Math.max(0, Math.min(pos, view.state.doc.content.size))
  try {
    const coords = view.coordsAtPos(safePos)
    if (!coords) return
    const container = view.dom.closest('.editor-scroll-container')
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    container.scrollTo({
      top: container.scrollTop + (coords.top - containerRect.top) - TOP_MARGIN_PX,
      behavior: 'smooth',
    })
  } catch {
    // Position out of range after a concurrent doc change — nothing to do.
  }
}

/**
 * Briefly highlight a block so the eye lands on it after the scroll.
 *
 * Uses the `.block-pulse` class rather than inline styles, and removes itself;
 * a caller that navigates away mid-pulse leaves no residue because the node is
 * looked up fresh each time.
 */
export function pulseBlock(view: EditorView | null | undefined, blockId: string): void {
  if (!view) return
  const el = view.dom.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`)
  if (!(el instanceof HTMLElement)) return
  el.classList.remove('block-pulse')
  // Force a reflow so re-adding the class restarts the animation when the
  // same block is clicked twice.
  void el.offsetWidth
  el.classList.add('block-pulse')
  window.setTimeout(() => el.classList.remove('block-pulse'), 1600)
}
