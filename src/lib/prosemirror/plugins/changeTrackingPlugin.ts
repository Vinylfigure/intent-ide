import { Plugin, PluginKey, Transaction } from 'prosemirror-state'
import { generateId } from '@/lib/utils/id'
import { blockIdPluginKey } from './blockIdPlugin'

interface ChangeTrackingState {
  lastChangeId: string | null
}

export const changeTrackingPluginKey = new PluginKey<ChangeTrackingState>('changeTracking')

// Callback type for when changes are detected
type ChangeCallback = (change: {
  id: string
  from: number
  to: number
  beforeSlice: string
  afterSlice: string
  steps: any[]
}) => void

let changeCallback: ChangeCallback | null = null

export function setChangeCallback(cb: ChangeCallback) {
  changeCallback = cb
}

export function createChangeTrackingPlugin(): Plugin {
  return new Plugin({
    key: changeTrackingPluginKey,

    state: {
      init(): ChangeTrackingState {
        return { lastChangeId: null }
      },
      apply(tr: Transaction, state: ChangeTrackingState): ChangeTrackingState {
        const meta = tr.getMeta(changeTrackingPluginKey)
        if (meta?.changeId) {
          return { lastChangeId: meta.changeId }
        }
        return state
      },
    },

    appendTransaction(transactions, oldState, newState) {
      // Only track actual document changes
      const docChanged = transactions.some(tr => tr.docChanged)
      if (!docChanged) return null

      // Skip undo/redo, our own tracking transactions, blockId stamping
      // (attr-only stamps would otherwise log phantom "Direct edit" entries),
      // and state loads: restore and document-switch dispatch a full-document
      // replaceWith with addToHistory:false — those are not edits, and must
      // not push full-document beforeSlice/afterSlice entries into the
      // persisted changes store.
      const skip = transactions.some(tr =>
        tr.getMeta('history$') ||
        tr.getMeta(changeTrackingPluginKey) ||
        tr.getMeta(blockIdPluginKey) ||
        tr.getMeta('addToHistory') === false
      )
      if (skip) return null

      // Compute the changed range
      let changeFrom = newState.doc.content.size
      let changeTo = 0

      transactions.forEach(tr => {
        tr.steps.forEach((step, i) => {
          const map = step.getMap()
          map.forEach((oldStart: number, oldEnd: number) => {
            changeFrom = Math.min(changeFrom, oldStart)
            changeTo = Math.max(changeTo, oldEnd)
          })
        })
      })

      if (changeFrom >= changeTo && changeFrom >= newState.doc.content.size) return null

      const id = generateId()

      // Extract text slices
      const beforeSlice = oldState.doc.textBetween(
        Math.min(changeFrom, oldState.doc.content.size),
        Math.min(changeTo, oldState.doc.content.size),
        ' '
      )
      const afterSlice = newState.doc.textBetween(
        Math.min(changeFrom, newState.doc.content.size),
        Math.min(changeTo, newState.doc.content.size),
        ' '
      )

      // Collect serialized steps
      const steps = transactions.flatMap(tr =>
        tr.steps.map(step => step.toJSON())
      )

      // Notify callback
      if (changeCallback) {
        changeCallback({ id, from: changeFrom, to: changeTo, beforeSlice, afterSlice, steps })
      }

      // Tag the transaction
      const tr = newState.tr.setMeta(changeTrackingPluginKey, { changeId: id })
      return tr
    },
  })
}
