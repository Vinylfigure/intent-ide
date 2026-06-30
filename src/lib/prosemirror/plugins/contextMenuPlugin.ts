import { Plugin } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { useEditorStore } from '@/stores/editorStore'
import { inferScope } from '../helpers'

/**
 * Trigger the floating icon bar above the current selection.
 * Can be called from hotkeys, right-click, or selection handlers.
 */
export function triggerFloatingBar(view: EditorView) {
  const { from, to } = view.state.selection
  if (from === to) return // no selection

  const scope = inferScope(view.state, from, to)
  const text = view.state.doc.textBetween(from, to)
  const coords = view.coordsAtPos(from)

  useEditorStore.getState().setContextMenu({
    x: coords.left,
    y: coords.top,
    from,
    to,
    text,
    scope,
  })
}

export function createContextMenuPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        contextmenu(view, event) {
          const { from, to } = view.state.selection
          if (from === to) return false // no selection, let native menu through

          event.preventDefault()
          triggerFloatingBar(view)
          return true
        },
        mouseup(view) {
          // Show floating bar on mouse text selection (after a frame so selection settles)
          requestAnimationFrame(() => {
            const { from, to } = view.state.selection
            if (from === to) {
              // Selection collapsed — dismiss floating bar if open
              useEditorStore.getState().clearContextMenu()
              return
            }
            // Don't re-trigger if already open at same position
            const existing = useEditorStore.getState().contextMenu
            if (existing && existing.from === from && existing.to === to) return
            triggerFloatingBar(view)
          })
          return false
        },
      },
      handleKeyDown(view, event) {
        // Trigger on keyboard selection (Shift+arrow/Home/End)
        if (event.shiftKey && /^Arrow|Home|End/.test(event.key)) {
          requestAnimationFrame(() => {
            const { from, to } = view.state.selection
            if (from === to) {
              // Selection collapsed — dismiss floating bar
              useEditorStore.getState().clearContextMenu()
              return
            }
            triggerFloatingBar(view)
          })
        }
        return false
      },
    },
  })
}
