import { Plugin, PluginKey, Transaction } from 'prosemirror-state'
import type { Scope } from '@/lib/annotations/types'

export interface FocusState {
  anchor: { from: number; to: number } | null
  source: 'selection' | 'cursor' | 'viewport' | 'lastInteraction'
  timestamp: number
}

export interface FocusMeta {
  viewport?: { from: number; to: number }
  lastInteraction?: { from: number; to: number }
}

export const focusPluginKey = new PluginKey<FocusState>('focus')

export function createFocusInferencePlugin(): Plugin {
  return new Plugin({
    key: focusPluginKey,

    state: {
      init(): FocusState {
        return { anchor: null, source: 'cursor', timestamp: Date.now() }
      },

      apply(tr: Transaction, state: FocusState, oldEditorState, newEditorState): FocusState {
        // Check for explicit focus meta
        const meta = tr.getMeta(focusPluginKey) as FocusMeta | undefined

        // Priority 1: Explicit text selection
        const { from, to } = newEditorState.selection
        if (from !== to) {
          return { anchor: { from, to }, source: 'selection', timestamp: Date.now() }
        }

        // Priority 2: Cursor position (resolve to containing block)
        if (from === to && tr.docChanged || tr.selectionSet) {
          const $pos = newEditorState.doc.resolve(from)
          const start = $pos.start($pos.depth)
          const end = $pos.end($pos.depth)
          return { anchor: { from: start, to: end }, source: 'cursor', timestamp: Date.now() }
        }

        // Priority 3: Viewport center (set via meta from scroll handler)
        if (meta?.viewport) {
          return { anchor: meta.viewport, source: 'viewport', timestamp: Date.now() }
        }

        // Priority 4: Last interaction
        if (meta?.lastInteraction) {
          return { anchor: meta.lastInteraction, source: 'lastInteraction', timestamp: Date.now() }
        }

        // Map existing anchor through changes
        if (state.anchor && tr.docChanged) {
          return {
            ...state,
            anchor: {
              from: tr.mapping.map(state.anchor.from),
              to: tr.mapping.map(state.anchor.to),
            },
          }
        }

        return state
      },
    },
  })
}

export function getCurrentFocus(state: any): FocusState | undefined {
  return focusPluginKey.getState(state)
}
