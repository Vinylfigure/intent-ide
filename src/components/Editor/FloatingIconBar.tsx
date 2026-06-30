'use client'

import { useEffect, useRef } from 'react'
import { useEditorStore } from '@/stores/editorStore'
import { createAnnotationFromText } from '@/lib/voice/pipeline'
import { AnnotationComposer } from '@/components/Annotations/AnnotationComposer'

const BAR_HEIGHT = 48
const GAP = 8

/**
 * Single natural-language input bar that appears on text selection.
 * No type picker — the user types/speaks naturally and the AI classifies automatically.
 */
export function FloatingIconBar() {
  const contextMenu = useEditorStore((s) => s.contextMenu)
  const clearContextMenu = useEditorStore((s) => s.clearContextMenu)
  const barRef = useRef<HTMLDivElement>(null)

  // Click outside + escape handler
  useEffect(() => {
    if (!contextMenu) return

    function handleClick(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        clearContextMenu()
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        clearContextMenu()
      }
    }

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick)
      document.addEventListener('keydown', handleKeyDown)
    }, 0)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu, clearContextMenu])

  if (!contextMenu) return null

  // Position above selection, clamped to viewport
  const barWidth = 360
  const left = Math.max(8, Math.min(contextMenu.x - barWidth / 2, window.innerWidth - barWidth - 8))
  const top = Math.max(8, contextMenu.y - BAR_HEIGHT - GAP)

  return (
    <div
      ref={barRef}
      className="fixed z-50"
      style={{ left, top }}
    >
      <AnnotationComposer
        mode="selection"
        className="w-[360px]"
        onSubmit={async ({ text, suggestedIntent }) => {
          await createAnnotationFromText(suggestedIntent ?? 'ask', text, contextMenu.from, contextMenu.to, {
            suggestedType: suggestedIntent,
          })
          clearContextMenu()
        }}
        onCancel={clearContextMenu}
      />

      {/* Caret pointing down at selection */}
      <div className="flex justify-center -mt-px">
        <div
          className="w-0 h-0"
          style={{
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: '6px solid white',
          }}
        />
      </div>
    </div>
  )
}
