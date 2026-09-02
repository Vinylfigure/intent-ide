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
 * Drawn as an OVERLAY in the scroll container, not as a class on the block.
 * The obvious implementation — add a class to the `[data-block-id]` element —
 * was tried and measured: ProseMirror re-renders the node view within a frame
 * of the scroll (the read-line plugin dispatches on scroll) and strips it, so
 * the highlight appeared for one frame and vanished. A MutationObserver
 * confirmed the class was applied exactly once and removed immediately.
 *
 * The overlay sits outside `.ProseMirror` entirely, so nothing ProseMirror
 * does can take it away. It is inert (`pointer-events: none`), removes itself,
 * and never survives into a second call.
 */

/** How long the highlight lingers. Matches the CSS animation duration. */
const PULSE_MS = 1600

export function pulseBlock(view: EditorView | null | undefined, blockId: string): void {
  if (!view) return
  const container = view.dom.closest('.editor-scroll-container')
  if (!(container instanceof HTMLElement)) return

  let el: Element | null = null
  try {
    el = view.dom.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`)
  } catch {
    return
  }
  if (!(el instanceof HTMLElement)) return

  // One highlight at a time: a reader clicking two passages in quick
  // succession must not be left with two competing marks.
  container.querySelectorAll('.block-pulse-overlay').forEach((node) => node.remove())

  // The container is the scrolling/positioning context, so offsets are taken
  // against it rather than the viewport — a smooth scroll in flight would
  // otherwise leave the overlay behind.
  const containerRect = container.getBoundingClientRect()
  const rect = el.getBoundingClientRect()

  const overlay = document.createElement('div')
  overlay.className = 'block-pulse-overlay'
  overlay.setAttribute('aria-hidden', 'true')
  overlay.style.top = `${rect.top - containerRect.top + container.scrollTop - 4}px`
  overlay.style.left = `${rect.left - containerRect.left + container.scrollLeft - 6}px`
  overlay.style.width = `${rect.width + 12}px`
  overlay.style.height = `${rect.height + 8}px`

  // The container needs to be a positioning context for an absolutely
  // positioned child; set it only if it is not one already, so an existing
  // layout choice is never overridden.
  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative'
  }
  container.appendChild(overlay)
  window.setTimeout(() => overlay.remove(), PULSE_MS)
}
