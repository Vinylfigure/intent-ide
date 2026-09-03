import { history, undo, redo } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap, toggleMark } from 'prosemirror-commands'
import { Plugin } from 'prosemirror-state'
import { schema } from '../schema'
import { createAnnotationPlugin } from './annotationPlugin'
import { createFocusInferencePlugin } from './focusInferencePlugin'
import { createChangeTrackingPlugin } from './changeTrackingPlugin'
import { createReadLinePlugin } from './readLinePlugin'
import { createContextMenuPlugin } from './contextMenuPlugin'
import { createConflictPlugin } from './conflictPlugin'
import { createUncertaintyPlugin } from './uncertaintyPlugin'
import { createProposedChangePlugin } from './proposedChangePlugin'
import { createBlockIdPlugin } from './blockIdPlugin'
import { createLinkClickPlugin } from './linkClickPlugin'
import { columnResizing, goToNextCell, tableEditing } from 'prosemirror-tables'

export function createPlugins(): Plugin[] {
  return [
    history(),
    keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo }),
    keymap({
      'Mod-b': toggleMark(schema.marks.strong),
      'Mod-i': toggleMark(schema.marks.em),
      'Mod-`': toggleMark(schema.marks.code),
      Tab: goToNextCell(1),
      'Shift-Tab': goToNextCell(-1),
    }),
    keymap(baseKeymap),
    createAnnotationPlugin(),
    createConflictPlugin(),
    createUncertaintyPlugin(),
    createProposedChangePlugin(),
    createFocusInferencePlugin(),
    createBlockIdPlugin(),
    createChangeTrackingPlugin(),
    createReadLinePlugin(),
    createContextMenuPlugin(),
    // Before contextMenuPlugin's mouseup would matter: a Cmd+click that opens a
    // link should not also leave a selection bar hanging over the document.
    createLinkClickPlugin(),
    columnResizing(),
    // Keep this last: it handles broad mouse/arrow behavior after more
    // specific editor plugins and column resizing have had their turn.
    tableEditing(),
  ]
}
