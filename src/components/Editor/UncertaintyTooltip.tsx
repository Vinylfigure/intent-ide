'use client'

import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useUncertaintyStore } from '@/stores/uncertaintyStore'
import { useEditorStore } from '@/stores/editorStore'
import { removeUncertaintyDecoration } from '@/lib/prosemirror/plugins/uncertaintyPlugin'

interface TooltipPosition {
  top: number
  left: number
}

export function UncertaintyTooltip() {
  const hoveredId = useUncertaintyStore((s) => s.hoveredTokenId)
  const activeId = useUncertaintyStore((s) => s.activeTokenId)
  const tokens = useUncertaintyStore((s) => s.tokens)
  const view = useEditorStore((s) => s.view)
  const [position, setPosition] = useState<TooltipPosition | null>(null)

  // Show tooltip for active (clicked) token, falling back to hovered
  const visibleId = activeId ?? hoveredId
  const token = visibleId ? tokens.find((t) => t.id === visibleId) : null

  useEffect(() => {
    if (!token || !view) {
      setPosition(null)
      return
    }

    try {
      const coords = view.coordsAtPos(token.from)
      setPosition({
        top: coords.top - 8,
        left: coords.left,
      })
    } catch {
      setPosition(null)
    }
  }, [token, view])

  // Close active tooltip on outside click
  useEffect(() => {
    if (!activeId) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (
        !target.closest('.uncertainty-tooltip-interactive') &&
        !target.closest('.uncertainty-highlight')
      ) {
        useUncertaintyStore.getState().setActive(null)
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

  const handleSwap = useCallback(
    (newText: string) => {
      if (!token || !view) return

      // Replace the token text in the document
      const tr = view.state.tr.replaceWith(
        token.from,
        token.to,
        view.state.schema.text(newText),
      )
      view.dispatch(tr)

      // Remove the uncertainty decoration and store entry
      removeUncertaintyDecoration(view, token.id)
      useUncertaintyStore.getState().setActive(null)
      useUncertaintyStore.getState().setHovered(null)
    },
    [token, view],
  )

  const handleDismiss = useCallback(() => {
    if (!token || !view) return
    removeUncertaintyDecoration(view, token.id)
    useUncertaintyStore.getState().setActive(null)
    useUncertaintyStore.getState().setHovered(null)
  }, [token, view])

  if (!token || !position) return null

  const hasAlternatives = token.alternatives.length > 0

  return createPortal(
    <div
      className="uncertainty-tooltip-interactive"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        transform: 'translateY(-100%)',
        zIndex: 9999,
      }}
    >
      <div className="uncertainty-tooltip-card">
        {/* Header */}
        <div className="flex items-center gap-1.5 mb-1">
          <span className="uncertainty-badge">
            Uncertain
          </span>
          <span className="text-[10px] font-mono text-muted">
            &ldquo;{token.originalToken}&rdquo;
          </span>
        </div>

        {/* Alternatives list */}
        {hasAlternatives ? (
          <div className="uncertainty-alternatives">
            <span className="text-[10px] font-mono text-muted">Alternatives:</span>
            <div className="uncertainty-alt-list">
              {token.alternatives.map((alt, i) => (
                <button
                  key={i}
                  className="uncertainty-alt-btn"
                  onClick={() => handleSwap(alt.token)}
                  title={`Replace with "${alt.token}" (${(alt.probability * 100).toFixed(1)}%)`}
                >
                  <span className="uncertainty-alt-token">{alt.token}</span>
                  <span className="uncertainty-alt-prob">
                    {(alt.probability * 100).toFixed(0)}%
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-muted leading-relaxed">
            Flagged as uncertain by MADS debate. No alternative tokens available.
          </p>
        )}

        {/* Actions */}
        <div className="uncertainty-actions">
          <button className="uncertainty-action-btn uncertainty-action-dismiss" onClick={handleDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
