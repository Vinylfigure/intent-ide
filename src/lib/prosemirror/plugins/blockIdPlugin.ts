import { Plugin, PluginKey } from 'prosemirror-state'
import { computeBlockIdFixes } from '../blockIds'

export const blockIdPluginKey = new PluginKey('blockIds')

/**
 * Stamps a persistent `blockId` on every block-level node whose id is null or
 * duplicated. Splitting a node (Enter mid-paragraph) copies attrs, so both halves
 * share an id until this plugin reassigns the second occurrence.
 *
 * History semantics (deliberate):
 * - appendTransaction stamps ride the triggering history event, so undoing a
 *   split also undoes the id reassignment (never a half-state). History
 *   transactions are NOT skipped — undo/redo can resurface missing/duplicate
 *   ids, and the idempotent fix computation makes the common case free.
 * - Initial-load stamping (view hook) uses addToHistory:false so the user's
 *   first undo isn't a no-op id revert. Document switches dispatch a
 *   replaceWith transaction and are covered by appendTransaction instead.
 */
export function createBlockIdPlugin(): Plugin {
  return new Plugin({
    key: blockIdPluginKey,

    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null
      // Loop guard (belt) — computeBlockIdFixes is idempotent (suspenders).
      if (transactions.some((tr) => tr.getMeta(blockIdPluginKey))) return null

      const fixes = computeBlockIdFixes(newState.doc)
      if (fixes.length === 0) return null

      const tr = newState.tr
      for (const fix of fixes) tr.setNodeMarkup(fix.pos, undefined, fix.attrs)
      return tr.setMeta(blockIdPluginKey, { stamped: fixes.length })
    },

    view(view) {
      // Deferred: plugin view hooks run synchronously inside the EditorView
      // constructor, and host dispatchTransaction closures typically reference
      // the `view` const being constructed (TDZ crash if we dispatch here).
      queueMicrotask(() => {
        if (view.isDestroyed) return
        const fixes = computeBlockIdFixes(view.state.doc)
        if (fixes.length > 0) {
          const tr = view.state.tr
          for (const fix of fixes) tr.setNodeMarkup(fix.pos, undefined, fix.attrs)
          view.dispatch(
            tr.setMeta(blockIdPluginKey, { stamped: fixes.length }).setMeta('addToHistory', false),
          )
        }
      })
      return {}
    },
  })
}
