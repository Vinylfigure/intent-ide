'use client'

import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useProposedEditUiStore } from '@/stores/proposedEditUiStore'
import { useEditorStore } from '@/stores/editorStore'
import {
  getProposedAnchors,
  setProposedEditStatus,
} from '@/lib/prosemirror/plugins/proposedChangePlugin'
import { SEVERITY_LABELS } from '@/lib/annotations/types'

interface ControlPosition {
  top: number
  left: number
}

/**
 * Inline Accept/Reject control for a click-pinned proposed edit. Mirrors
 * ConflictTooltip's positioning/portal/outside-click structure. Accept/Reject
 * only flip the edit's review status — they never mutate the document. A
 * separate batched apply consumes the accepted statuses.
 */
export function ProposedEditControl() {
  const activeId = useProposedEditUiStore((s) => s.activeId)
  const view = useEditorStore((s) => s.view)
  const [position, setPosition] = useState<ControlPosition | null>(null)

  const anchor = activeId && view ? getProposedAnchors(view.state).get(activeId) : undefined

  useEffect(() => {
    if (!anchor || !view) {
      setPosition(null)
      return
    }

    try {
      const coords = view.coordsAtPos(anchor.from)
      setPosition({
        top: coords.top - 8,
        left: coords.left,
      })
    } catch {
      setPosition(null)
    }
  }, [anchor, view])

  // Close on outside click
  useEffect(() => {
    if (!activeId) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // Don't dismiss when clicking another proposed-edit decoration — the plugin's
      // own click handler re-pins to it, so the control should switch, not close.
      if (
        !target.closest('.proposed-edit-control') &&
        !target.closest('[data-proposed-edit-id]')
      ) {
        useProposedEditUiStore.getState().clear()
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handleClick)
    }
  }, [activeId])

  const handleAccept = useCallback(() => {
    if (!view || !activeId) return
    // Status-only: never mutates the document. Batched apply does that.
    setProposedEditStatus(view, activeId, 'accepted')
    useProposedEditUiStore.getState().clear()
  }, [view, activeId])

  const handleReject = useCallback(() => {
    if (!view || !activeId) return
    setProposedEditStatus(view, activeId, 'rejected')
    useProposedEditUiStore.getState().clear()
  }, [view, activeId])

  if (!activeId || !anchor || !position) return null

  return createPortal(
    <div
      className="proposed-edit-control"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        transform: 'translateY(-100%)',
        zIndex: 9999,
      }}
    >
      <div className="proposed-edit-control-card">
        <div className="proposed-edit-control-header">
          <span className={`proposed-edit-severity proposed-edit-severity-${anchor.severity}`}>
            {SEVERITY_LABELS[anchor.severity]}
          </span>
        </div>
        {anchor.reason && (
          <p className="proposed-edit-control-reason">{anchor.reason}</p>
        )}
        {anchor.evidence && (
          <p className="proposed-edit-control-evidence">
            &ldquo;{anchor.evidence.quotedText}&rdquo; · {anchor.evidence.edgeType}
          </p>
        )}
        <div className="proposed-edit-control-actions">
          <button
            className="proposed-edit-control-btn proposed-edit-control-accept"
            onClick={handleAccept}
            title="Accept this proposed edit"
          >
            Accept
          </button>
          <button
            className="proposed-edit-control-btn proposed-edit-control-reject"
            onClick={handleReject}
            title="Reject this proposed edit"
          >
            Reject
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
