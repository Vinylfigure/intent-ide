'use client'

import { useEffect, useRef } from 'react'
import { useEditorStore } from '@/stores/editorStore'
import { captureAndResolveInBackground } from '@/lib/voice/pipeline'
import { AnnotationComposer } from '@/components/Annotations/AnnotationComposer'
import { peekRelatedCount } from '@/lib/ai/intentContext'
import { detectUrl } from '@/lib/annotations/selectionOffers'

const BAR_HEIGHT = 48
const GAP = 8

/**
 * Single natural-language input bar that appears on text selection.
 * No type picker — the user types/speaks naturally and the AI classifies automatically.
 */
export function FloatingIconBar() {
  const contextMenu = useEditorStore((s) => s.contextMenu)
  const view = useEditorStore((s) => s.view)
  const clearContextMenu = useEditorStore((s) => s.clearContextMenu)
  // null until the reader types — while it is null, focus stays in the document
  // and Cmd+C, Cmd+X and caret keys all behave natively over the selection.
  const composerSeed = useEditorStore((s) => s.composerSeed)
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

  // The selection already knows its own text and shape — the composer was
  // simply never told. One synchronous graph peek adds "is there anything else
  // in the document about this", which is the difference between a generic
  // offer and one worth clicking.
  const relatedCount = view ? peekRelatedCount(view.state, contextMenu.from) : 0
  // Cmd/Ctrl+click opens a link, but a modifier nobody announces is a modifier
  // nobody finds — so a highlighted URL also gets a visible way out.
  const selectedUrl = detectUrl(contextMenu.text)

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
        // Deliberately unfocused until the first keystroke. An autofocused
        // input took the document selection the instant a highlight finished,
        // which is why copying your own text did not work.
        autoFocus={composerSeed !== null}
        initialText={composerSeed ?? ''}
        onOpenLink={
          selectedUrl
            ? () => {
                window.open(selectedUrl, '_blank', 'noopener,noreferrer')
                clearContextMenu()
              }
            : undefined
        }
        onCopy={() => {
          void navigator.clipboard?.writeText(contextMenu.text)
          clearContextMenu()
        }}
        selectionAnchor={{
          from: contextMenu.from,
          to: contextMenu.to,
          text: contextMenu.text,
          scope: contextMenu.scope,
        }}
        offerContext={{ relatedCount }}
        onSubmit={({ text, suggestedIntent, skipClassify }) => {
          captureAndResolveInBackground(suggestedIntent ?? 'ask', text, contextMenu.from, contextMenu.to, {
            suggestedType: suggestedIntent,
            notify: 'quiet',
            skipClassify,
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
