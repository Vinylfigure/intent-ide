import { Plugin, PluginKey, Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'
import { useConflictStore, type ConflictSeverity } from '@/stores/conflictStore'

interface ConflictAnchor {
  from: number
  to: number
  severity: ConflictSeverity
}

interface ConflictPluginState {
  decorations: DecorationSet
  anchors: Map<string, ConflictAnchor>
}

export interface ConflictMeta {
  action: 'addConflict' | 'removeConflict' | 'clearAll'
  id?: string
  from?: number
  to?: number
  severity?: ConflictSeverity
}

export const conflictPluginKey = new PluginKey<ConflictPluginState>('conflicts')

function buildConflictDecoration(
  id: string,
  from: number,
  to: number,
  severity: ConflictSeverity,
): Decoration {
  return Decoration.inline(from, to, {
    class: `conflict-highlight conflict-${severity}`,
    'data-conflict-id': id,
  }, { conflictId: id })
}

export function createConflictPlugin(): Plugin {
  return new Plugin({
    key: conflictPluginKey,

    state: {
      init(): ConflictPluginState {
        return {
          decorations: DecorationSet.empty,
          anchors: new Map(),
        }
      },

      apply(tr: Transaction, pluginState: ConflictPluginState): ConflictPluginState {
        let { decorations, anchors } = pluginState

        // Map existing decorations through transaction
        decorations = decorations.map(tr.mapping, tr.doc)

        // Map anchor positions
        const newAnchors = new Map<string, ConflictAnchor>()
        for (const [id, anchor] of anchors) {
          newAnchors.set(id, {
            ...anchor,
            from: tr.mapping.map(anchor.from),
            to: tr.mapping.map(anchor.to),
          })
        }
        anchors = newAnchors

        // Handle meta commands
        const meta = tr.getMeta(conflictPluginKey) as ConflictMeta | undefined
        if (meta) {
          if (meta.action === 'addConflict' && meta.id && meta.from !== undefined && meta.to !== undefined && meta.severity) {
            anchors.set(meta.id, { from: meta.from, to: meta.to, severity: meta.severity })
            decorations = decorations.add(tr.doc, [
              buildConflictDecoration(meta.id, meta.from, meta.to, meta.severity),
            ])
          }

          if (meta.action === 'removeConflict' && meta.id) {
            anchors.delete(meta.id)
            const existing = decorations.find(
              undefined, undefined,
              (spec: Record<string, unknown>) => spec.conflictId === meta.id
            )
            decorations = decorations.remove(existing)
          }

          if (meta.action === 'clearAll') {
            anchors = new Map()
            decorations = DecorationSet.empty
          }
        }

        return { decorations, anchors }
      },
    },

    props: {
      decorations(state) {
        return conflictPluginKey.getState(state)?.decorations
      },

      handleDOMEvents: {
        mouseover(_view: EditorView, event: Event) {
          const target = (event.target as HTMLElement).closest?.('[data-conflict-id]')
          if (target) {
            const conflictId = target.getAttribute('data-conflict-id')
            if (conflictId) {
              useConflictStore.getState().setHovered(conflictId)
            }
          }
          return false
        },
        mouseout(_view: EditorView, event: Event) {
          const target = (event.target as HTMLElement).closest?.('[data-conflict-id]')
          if (target) {
            useConflictStore.getState().setHovered(null)
          }
          return false
        },
        click(_view: EditorView, event: Event) {
          const target = (event.target as HTMLElement).closest?.('[data-conflict-id]')
          if (target) {
            const conflictId = target.getAttribute('data-conflict-id')
            if (conflictId) {
              const store = useConflictStore.getState()
              // Toggle: click again to close
              store.setActive(store.activeConflictId === conflictId ? null : conflictId)
              return true
            }
          }
          return false
        },
      },
    },
  })
}

// Helper: add a conflict decoration
export function addConflictDecoration(
  view: EditorView,
  id: string,
  from: number,
  to: number,
  severity: ConflictSeverity,
) {
  const tr = view.state.tr.setMeta(conflictPluginKey, {
    action: 'addConflict', id, from, to, severity,
  } as ConflictMeta)
  view.dispatch(tr)
}

// Helper: remove a conflict decoration
export function removeConflictDecoration(view: EditorView, id: string) {
  const tr = view.state.tr.setMeta(conflictPluginKey, {
    action: 'removeConflict', id,
  } as ConflictMeta)
  view.dispatch(tr)
}

// Helper: clear all conflict decorations
export function clearAllConflictDecorations(view: EditorView) {
  const tr = view.state.tr.setMeta(conflictPluginKey, {
    action: 'clearAll',
  } as ConflictMeta)
  view.dispatch(tr)
}
