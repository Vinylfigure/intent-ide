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

export function createPlugins(): Plugin[] {
  return [
    history(),
    keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo }),
    keymap({
      'Mod-b': toggleMark(schema.marks.strong),
      'Mod-i': toggleMark(schema.marks.em),
      'Mod-`': toggleMark(schema.marks.code),
    }),
    keymap(baseKeymap),
    createAnnotationPlugin(),
    createConflictPlugin(),
    createUncertaintyPlugin(),
    createProposedChangePlugin(),
    createFocusInferencePlugin(),
    createChangeTrackingPlugin(),
    createReadLinePlugin(),
    createContextMenuPlugin(),
  ]
}
