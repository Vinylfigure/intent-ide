import { Plugin, PluginKey, Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'
import { useUncertaintyStore, type UncertainToken, type TokenAlternative } from '@/stores/uncertaintyStore'

interface StoredToken {
  from: number
  to: number
  editProbability: number
  originalToken: string
  alternatives: TokenAlternative[]
}

interface UncertaintyPluginState {
  decorations: DecorationSet
  tokens: Map<string, StoredToken>
}

export interface UncertaintyMeta {
  action: 'addTokens' | 'removeToken' | 'clearAll'
  id?: string
  tokens?: UncertainToken[]
}

export const uncertaintyPluginKey = new PluginKey<UncertaintyPluginState>('uncertainty')

/**
 * Maps edit probability (0–1) to an HSL background color.
 * Low probability → barely visible warm yellow
 * High probability → noticeable warm red/orange
 * No raw numbers shown to user (per spec Section 3B).
 */
function probabilityToBackground(p: number): string {
  // Clamp to 0–1
  const clamped = Math.max(0, Math.min(1, p))
  // Hue: 45 (warm yellow) → 0 (red) as probability increases
  const hue = Math.round(45 * (1 - clamped))
  // Saturation: higher for more uncertain
  const saturation = Math.round(60 + 30 * clamped)
  // Alpha: subtle for low, more visible for high
  const alpha = (0.08 + 0.22 * clamped).toFixed(2)
  return `hsla(${hue}, ${saturation}%, 55%, ${alpha})`
}

function buildUncertaintyDecoration(
  id: string,
  from: number,
  to: number,
  editProbability: number,
): Decoration {
  return Decoration.inline(from, to, {
    class: 'uncertainty-highlight',
    style: `background-color: ${probabilityToBackground(editProbability)}`,
    'data-uncertainty-id': id,
  }, { uncertaintyId: id })
}

export function createUncertaintyPlugin(): Plugin {
  return new Plugin({
    key: uncertaintyPluginKey,

    state: {
      init(): UncertaintyPluginState {
        return {
          decorations: DecorationSet.empty,
          tokens: new Map(),
        }
      },

      apply(tr: Transaction, pluginState: UncertaintyPluginState): UncertaintyPluginState {
        let { decorations, tokens } = pluginState

        // Map decorations and token positions through transaction
        decorations = decorations.map(tr.mapping, tr.doc)

        const newTokens = new Map<string, StoredToken>()
        for (const [id, token] of tokens) {
          newTokens.set(id, {
            ...token,
            from: tr.mapping.map(token.from),
            to: tr.mapping.map(token.to),
          })
        }
        tokens = newTokens

        // Handle meta commands
        const meta = tr.getMeta(uncertaintyPluginKey) as UncertaintyMeta | undefined
        if (meta) {
          if (meta.action === 'addTokens' && meta.tokens) {
            const newDecos: Decoration[] = []
            for (const t of meta.tokens) {
              tokens.set(t.id, {
                from: t.from,
                to: t.to,
                editProbability: t.editProbability,
                originalToken: t.originalToken,
                alternatives: t.alternatives,
              })
              newDecos.push(buildUncertaintyDecoration(t.id, t.from, t.to, t.editProbability))
            }
            decorations = decorations.add(tr.doc, newDecos)
          }

          if (meta.action === 'removeToken' && meta.id) {
            tokens.delete(meta.id)
            const existing = decorations.find(
              undefined, undefined,
              (spec: Record<string, unknown>) => spec.uncertaintyId === meta.id
            )
            decorations = decorations.remove(existing)
          }

          if (meta.action === 'clearAll') {
            tokens = new Map()
            decorations = DecorationSet.empty
          }
        }

        return { decorations, tokens }
      },
    },

    props: {
      decorations(state) {
        return uncertaintyPluginKey.getState(state)?.decorations
      },

      handleDOMEvents: {
        mouseover(view: EditorView, event: MouseEvent) {
          const target = event.target as HTMLElement
          const id = target.closest('.uncertainty-highlight')?.getAttribute('data-uncertainty-id')
          const store = useUncertaintyStore.getState()
          if (id && id !== store.hoveredTokenId && id !== store.activeTokenId) {
            store.setHovered(id)
          }
          return false
        },
        mouseout(view: EditorView, event: MouseEvent) {
          const related = event.relatedTarget as HTMLElement | null
          if (!related?.closest('.uncertainty-highlight') && !related?.closest('.uncertainty-tooltip-interactive')) {
            useUncertaintyStore.getState().setHovered(null)
          }
          return false
        },
        click(view: EditorView, event: MouseEvent) {
          const target = event.target as HTMLElement
          const el = target.closest('.uncertainty-highlight')
          const id = el?.getAttribute('data-uncertainty-id')
          if (id) {
            const store = useUncertaintyStore.getState()
            store.setActive(store.activeTokenId === id ? null : id)
            return true
          }
          return false
        },
      },
    },
  })
}

// Helper: add uncertainty tokens as decorations
export function addUncertaintyDecorations(
  view: EditorView,
  tokens: UncertainToken[],
) {
  const tr = view.state.tr.setMeta(uncertaintyPluginKey, {
    action: 'addTokens', tokens,
  } as UncertaintyMeta)
  view.dispatch(tr)
  useUncertaintyStore.getState().addTokens(tokens)
}

// Helper: remove a single uncertainty decoration
export function removeUncertaintyDecoration(view: EditorView, id: string) {
  const tr = view.state.tr.setMeta(uncertaintyPluginKey, {
    action: 'removeToken', id,
  } as UncertaintyMeta)
  view.dispatch(tr)
  useUncertaintyStore.getState().removeToken(id)
}

// Helper: clear all uncertainty decorations
export function clearAllUncertaintyDecorations(view: EditorView) {
  const tr = view.state.tr.setMeta(uncertaintyPluginKey, {
    action: 'clearAll',
  } as UncertaintyMeta)
  view.dispatch(tr)
  useUncertaintyStore.getState().clearAll()
}
