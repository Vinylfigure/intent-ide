'use client'

import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { TextSelection } from 'prosemirror-state'
import { useConflictStore } from '@/stores/conflictStore'
import { useEditorStore } from '@/stores/editorStore'
import { removeConflictDecoration } from '@/lib/prosemirror/plugins/conflictPlugin'

interface TooltipPosition {
  top: number
  left: number
}

export function ConflictTooltip() {
  const hoveredId = useConflictStore((s) => s.hoveredConflictId)
  const activeId = useConflictStore((s) => s.activeConflictId)
  const conflicts = useConflictStore((s) => s.conflicts)
  const view = useEditorStore((s) => s.view)
  const [position, setPosition] = useState<TooltipPosition | null>(null)

  // Show tooltip for active (clicked) conflict, falling back to hovered
  const visibleId = activeId ?? hoveredId
  const conflict = visibleId ? conflicts.find((c) => c.id === visibleId) : null

  useEffect(() => {
    if (!conflict || !view) {
      setPosition(null)
      return
    }

    try {
      const coords = view.coordsAtPos(conflict.from)
      setPosition({
        top: coords.top - 8,
        left: coords.left,
      })
    } catch {
      setPosition(null)
    }
  }, [conflict, view])

  // Close active tooltip on outside click
  useEffect(() => {
    if (!activeId) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.conflict-tooltip-interactive')) {
        useConflictStore.getState().setActive(null)
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
    if (!conflict || !view) return
    if (conflict.proposedText !== null) {
      const tr = conflict.proposedText
        ? view.state.tr.replaceWith(
            conflict.from,
            conflict.to,
            view.state.schema.text(conflict.proposedText)
          )
        : view.state.tr.delete(conflict.from, conflict.to)
      view.dispatch(tr)
    }
    removeConflictDecoration(view, conflict.id)
    useConflictStore.getState().removeConflict(conflict.id)
    useConflictStore.getState().setActive(null)
  }, [conflict, view])

  const handleReject = useCallback(() => {
    if (!conflict || !view) return
    removeConflictDecoration(view, conflict.id)
    useConflictStore.getState().removeConflict(conflict.id)
    useConflictStore.getState().setActive(null)
  }, [conflict, view])

  const handleRevise = useCallback(() => {
    if (!conflict || !view) return
    const tr = view.state.tr.setSelection(
      TextSelection.near(view.state.doc.resolve(conflict.from))
    )
    view.dispatch(tr)
    view.focus()
    useConflictStore.getState().setActive(null)
  }, [conflict, view])

  const handleDelete = useCallback(() => {
    if (!conflict || !view) return
    const tr = view.state.tr.delete(conflict.from, conflict.to)
    view.dispatch(tr)
    removeConflictDecoration(view, conflict.id)
    useConflictStore.getState().removeConflict(conflict.id)
    useConflictStore.getState().setActive(null)
  }, [conflict, view])

  if (!conflict || !position) return null

  const isDirect = conflict.severity === 'direct'

  return createPortal(
    <div
      className="conflict-tooltip-interactive"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        transform: 'translateY(-100%)',
        zIndex: 9999,
      }}
    >
      <div className="conflict-tooltip-card">
        {/* Severity badge */}
        <div className="flex items-center gap-1.5 mb-1">
          <span
            className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: isDirect ? 'rgba(220,38,38,0.12)' : 'rgba(245,158,11,0.12)',
              color: isDirect ? '#dc2626' : '#f59e0b',
            }}
          >
            {isDirect ? 'Direct Conflict' : 'Ambiguous'}
          </span>
        </div>

        {/* Reasoning */}
        <p className="text-xs text-ink leading-relaxed mb-2">{conflict.reasoning}</p>

        {/* Proposed text preview */}
        {conflict.proposedText !== null && (
          <div className="conflict-proposed-text">
            <span className="text-[10px] font-mono text-muted-foreground">Proposed:</span>
            <p className="text-xs text-ink mt-0.5">{conflict.proposedText || '(delete)'}</p>
          </div>
        )}

        {/* Resolution action buttons */}
        <div className="conflict-actions">
          <button
            className="conflict-action-btn conflict-action-revise"
            onClick={handleRevise}
            title="Position cursor at conflict for manual editing"
          >
            Revise
          </button>
          <button
            className="conflict-action-btn conflict-action-delete"
            onClick={handleDelete}
            title="Delete the conflicting text"
          >
            Delete
          </button>
          {conflict.proposedText !== null && (
            <button
              className="conflict-action-btn conflict-action-accept"
              onClick={handleAccept}
              title="Accept proposed replacement"
            >
              Accept
            </button>
          )}
          <button
            className="conflict-action-btn conflict-action-reject"
            onClick={handleReject}
            title="Dismiss conflict, keep original text"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
