import { Plugin, PluginKey, Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'

interface ReadLineState {
  highWaterMark: number  // Furthest doc position read
  readPositions: Set<number>  // Block positions that have been "read"
}

export interface ReadLineMeta {
  markRead?: number  // Position to mark as read
}

export const readLinePluginKey = new PluginKey<ReadLineState>('readLine')

export function createReadLinePlugin(): Plugin {
  let scrollTimeout: ReturnType<typeof setTimeout> | null = null
  let dwellTimeout: ReturnType<typeof setTimeout> | null = null

  return new Plugin({
    key: readLinePluginKey,

    state: {
      init(): ReadLineState {
        return { highWaterMark: 0, readPositions: new Set() }
      },

      apply(tr: Transaction, state: ReadLineState): ReadLineState {
        const meta = tr.getMeta(readLinePluginKey) as ReadLineMeta | undefined
        if (meta?.markRead !== undefined) {
          const newPos = meta.markRead
          const newReadPositions = new Set(state.readPositions)
          newReadPositions.add(newPos)
          return {
            highWaterMark: Math.max(state.highWaterMark, newPos),
            readPositions: newReadPositions,
          }
        }
        return state
      },
    },

    view(editorView: EditorView) {
      const dom = editorView.dom

      function handleScroll() {
        if (scrollTimeout) clearTimeout(scrollTimeout)
        if (dwellTimeout) clearTimeout(dwellTimeout)

        scrollTimeout = setTimeout(() => {
          // After scroll settles (300ms), start dwell timer
          const viewportCenter = dom.getBoundingClientRect().top + dom.clientHeight / 2
          const pos = editorView.posAtCoords({ left: dom.getBoundingClientRect().left + 10, top: viewportCenter })

          if (pos) {
            const $pos = editorView.state.doc.resolve(pos.pos)
            const blockStart = $pos.start($pos.depth)
            const blockEnd = $pos.end($pos.depth)
            const text = editorView.state.doc.textBetween(blockStart, blockEnd)
            const wordCount = text.split(/\s+/).length
            const dwellMs = Math.max(2000, (wordCount / 250) * 60000)

            dwellTimeout = setTimeout(() => {
              const tr = editorView.state.tr.setMeta(readLinePluginKey, {
                markRead: blockEnd,
              } as ReadLineMeta)
              editorView.dispatch(tr)
            }, dwellMs)
          }
        }, 300)
      }

      const scrollParent = dom.closest('.editor-scroll-container') || dom.parentElement
      scrollParent?.addEventListener('scroll', handleScroll, { passive: true })

      return {
        update() {},
        destroy() {
          scrollParent?.removeEventListener('scroll', handleScroll)
          if (scrollTimeout) clearTimeout(scrollTimeout)
          if (dwellTimeout) clearTimeout(dwellTimeout)
        },
      }
    },

    props: {
      decorations(state) {
        const pluginState = readLinePluginKey.getState(state)
        if (!pluginState || pluginState.highWaterMark === 0) {
          return DecorationSet.empty
        }

        // Add a widget decoration at the high-water mark
        const widget = Decoration.widget(pluginState.highWaterMark, () => {
          const el = document.createElement('div')
          el.className = 'read-line-indicator'
          return el
        }, { side: 1, key: 'read-line' })

        return DecorationSet.create(state.doc, [widget])
      },
    },
  })
}
