'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useDocumentStore } from '@/stores/documentStore'
import { useEditorStore } from '@/stores/editorStore'
import { useLayoutStore } from '@/stores/layoutStore'
import { AnnotationCard } from './AnnotationCard'
import {
  computeFloatingPosition,
  isAnchorOnScreen,
  type AnchorRect,
  type FloatingPosition,
} from '@/lib/annotations/floatingPosition'

/** Used until the panel has been measured once. */
const DEFAULT_PANEL = { width: 380, height: 320 }
const PANEL_WIDTH = 380

/**
 * Viewport rect covering the annotated passage, or null when ProseMirror
 * cannot resolve the anchor (stale position after an edit, unmounted view).
 */
function anchorRect(
  view: ReturnType<typeof useEditorStore.getState>['view'],
  from: number,
  to: number,
): AnchorRect | null {
  if (!view) return null
  try {
    const size = view.state.doc.content.size
    const start = Math.max(0, Math.min(from, size))
    const end = Math.max(start, Math.min(to, size))
    const a = view.coordsAtPos(start)
    const b = view.coordsAtPos(end)
    return {
      top: Math.min(a.top, b.top),
      bottom: Math.max(a.bottom, b.bottom),
      left: Math.min(a.left, b.left),
      right: Math.max(a.right, b.right),
    }
  } catch {
    return null
  }
}

/**
 * The answer for the active annotation, detached from the sidebar and parked
 * beside the passage it belongs to. Rendered only while the answer placement
 * preference is `floating`; the sidebar keeps a compact index of the same
 * threads and hands the detail over via `detailElsewhere`.
 */
export function FloatingAnswer() {
  const placement = useLayoutStore((s) => s.answerPlacement)
  const offset = useLayoutStore((s) => s.floatingOffset)
  const activeId = useAnnotationStore((s) => s.activeAnnotationId)
  const annotations = useAnnotationStore((s) => s.annotations)
  const setActive = useAnnotationStore((s) => s.setActive)
  const activeDocumentId = useDocumentStore((s) => s.activeDocumentId)
  const view = useEditorStore((s) => s.view)

  const panelRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<FloatingPosition | null>(null)
  const [mounted, setMounted] = useState(false)

  const annotation = annotations.find((a) => a.id === activeId) ?? null
  const visible =
    placement === 'floating' && !!annotation && annotation.documentId === activeDocumentId

  // Portals need a document; Next renders this component on the server too.
  useEffect(() => setMounted(true), [])

  const from = annotation?.anchor.from ?? 0
  const to = annotation?.anchor.to ?? 0

  const recompute = useCallback(() => {
    if (!visible) return
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const rect = anchorRect(view, from, to)
    const measured = panelRef.current?.getBoundingClientRect()
    setPosition(
      computeFloatingPosition({
        anchor: isAnchorOnScreen(rect, viewport) ? rect : null,
        panel: measured?.height
          ? { width: measured.width, height: measured.height }
          : DEFAULT_PANEL,
        viewport,
        offset,
      }),
    )
  }, [visible, view, from, to, offset])

  // Position before paint so the panel never flashes at the wrong place.
  useLayoutEffect(() => {
    recompute()
  }, [recompute])

  // Follow the passage while the user scrolls or resizes. `capture: true`
  // catches the editor's own scroll container, which does not bubble.
  useEffect(() => {
    if (!visible) return
    let frame = 0
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        recompute()
      })
    }
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    }
  }, [visible, recompute])

  // The card grows as the answer streams in; re-clamp when it does.
  useEffect(() => {
    const node = panelRef.current
    if (!visible || !node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => recompute())
    observer.observe(node)
    return () => observer.disconnect()
  }, [visible, recompute])

  // Escape closes the panel — the same gesture that dismisses every other
  // overlay in the app.
  useEffect(() => {
    if (!visible) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setActive(null)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [visible, setActive])

  const handleDragStart = useCallback((e: React.PointerEvent) => {
    // Ignore drags started on the header's buttons.
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const start = useLayoutStore.getState().floatingOffset

    function handleMove(move: PointerEvent) {
      useLayoutStore.getState().setFloatingOffset({
        dx: start.dx + (move.clientX - startX),
        dy: start.dy + (move.clientY - startY),
      })
    }
    function handleUp() {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }, [])

  if (!mounted || !visible || !annotation || !position) return null

  const dragged = offset.dx !== 0 || offset.dy !== 0

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Answer for “${annotation.anchor.text.slice(0, 60)}”`}
      className="floating-answer-panel"
      style={{ left: position.left, top: position.top, width: PANEL_WIDTH }}
    >
      <div className="floating-answer-header" onPointerDown={handleDragStart}>
        <span className="floating-answer-grip" aria-hidden="true">
          ⠿
        </span>
        <span className="floating-answer-title">Answer</span>
        <div className="floating-answer-header-actions">
          {dragged && (
            <button
              type="button"
              onClick={() => useLayoutStore.getState().resetFloatingOffset()}
              className="floating-answer-btn"
              title="Snap back beside the passage"
            >
              Snap back
            </button>
          )}
          <button
            type="button"
            onClick={() => useLayoutStore.getState().setAnswerPlacement('sidebar')}
            className="floating-answer-btn"
            title="Move answers back into the sidebar"
          >
            Dock
          </button>
          <button
            type="button"
            onClick={() => setActive(null)}
            className="floating-answer-btn floating-answer-close"
            aria-label="Close answer"
            title="Close (Esc)"
          >
            ×
          </button>
        </div>
      </div>

      <div className="floating-answer-body">
        <AnnotationCard annotation={annotation} isActive lockActive />
      </div>
    </div>,
    document.body,
  )
}
