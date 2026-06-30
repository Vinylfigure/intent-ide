'use client'

import { useCallback, useEffect, useState } from 'react'
import { useEditorStore } from '@/stores/editorStore'
import { toggleMark, setBlockType, wrapIn } from 'prosemirror-commands'
import { wrapInList } from 'prosemirror-schema-list'
import { schema } from '@/lib/prosemirror/schema'
import type { EditorState, Transaction } from 'prosemirror-state'
import type { MarkType, NodeType } from 'prosemirror-model'

function isMarkActive(state: EditorState, markType: MarkType | undefined) {
  if (!markType) return false
  const { from, $from, to, empty } = state.selection
  if (empty) {
    return !!markType.isInSet(state.storedMarks || $from.marks())
  }
  return state.doc.rangeHasMark(from, to, markType)
}

function isBlockType(state: EditorState, nodeType: NodeType | undefined, attrs?: Record<string, unknown>) {
  if (!nodeType) return false
  const { $from } = state.selection
  const node = $from.parent
  if (attrs) {
    return node.type === nodeType && Object.entries(attrs).every(([k, v]) => node.attrs[k] === v)
  }
  return node.type === nodeType
}

interface ToolbarButton {
  label: string
  title: string
  action: () => void
  isActive: boolean
}

export function FormattingToolbar() {
  const view = useEditorStore((s) => s.view)
  const [tick, setTick] = useState(0)

  // Re-render on every transaction by monkey-patching dispatchTransaction
  useEffect(() => {
    if (!view) return
    const original = view.dispatch.bind(view)
    const patched = (tr: Transaction) => {
      original(tr)
      setTick((n) => n + 1)
    }
    view.dispatch = patched
    return () => {
      view.dispatch = original
    }
  }, [view])

  // Also update on focus/blur for initial render correctness
  useEffect(() => {
    if (!view) return
    const handler = () => setTick((n) => n + 1)
    view.dom.addEventListener('focus', handler)
    view.dom.addEventListener('blur', handler)
    return () => {
      view.dom.removeEventListener('focus', handler)
      view.dom.removeEventListener('blur', handler)
    }
  }, [view])

  const run = useCallback((command: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean) => {
    if (!view) return
    command(view.state, view.dispatch)
    view.focus()
  }, [view])

  if (!view) return null

  const state = view.state
  // Use tick to prevent React from optimizing away re-renders
  void tick

  const buttons: ToolbarButton[] = []

  // Only add buttons for marks/nodes that exist in the schema
  if (schema.marks.strong) {
    buttons.push({
      label: 'B',
      title: 'Bold (Mod+B)',
      action: () => run(toggleMark(schema.marks.strong)),
      isActive: isMarkActive(state, schema.marks.strong),
    })
  }
  if (schema.marks.em) {
    buttons.push({
      label: 'I',
      title: 'Italic (Mod+I)',
      action: () => run(toggleMark(schema.marks.em)),
      isActive: isMarkActive(state, schema.marks.em),
    })
  }
  if (schema.marks.code) {
    buttons.push({
      label: '</>',
      title: 'Inline Code (Mod+`)',
      action: () => run(toggleMark(schema.marks.code)),
      isActive: isMarkActive(state, schema.marks.code),
    })
  }
  if (schema.nodes.heading) {
    buttons.push(
      {
        label: 'H1',
        title: 'Heading 1',
        action: () => run(setBlockType(schema.nodes.heading, { level: 1 })),
        isActive: isBlockType(state, schema.nodes.heading, { level: 1 }),
      },
      {
        label: 'H2',
        title: 'Heading 2',
        action: () => run(setBlockType(schema.nodes.heading, { level: 2 })),
        isActive: isBlockType(state, schema.nodes.heading, { level: 2 }),
      },
      {
        label: 'H3',
        title: 'Heading 3',
        action: () => run(setBlockType(schema.nodes.heading, { level: 3 })),
        isActive: isBlockType(state, schema.nodes.heading, { level: 3 }),
      },
    )
  }
  if (schema.nodes.bullet_list) {
    buttons.push({
      label: '\u2022',
      title: 'Bullet List',
      action: () => run(wrapInList(schema.nodes.bullet_list)),
      isActive: false,
    })
  }
  if (schema.nodes.ordered_list) {
    buttons.push({
      label: '1.',
      title: 'Ordered List',
      action: () => run(wrapInList(schema.nodes.ordered_list)),
      isActive: false,
    })
  }
  if (schema.nodes.blockquote) {
    buttons.push({
      label: '\u201C',
      title: 'Blockquote',
      action: () => run(wrapIn(schema.nodes.blockquote)),
      isActive: isBlockType(state, schema.nodes.blockquote),
    })
  }

  if (buttons.length === 0) return null

  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border/40 bg-white/40 rounded-t-[28px]">
      {buttons.map((btn, i) => (
        <button
          key={i}
          onClick={btn.action}
          title={btn.title}
          className={`px-2 py-1 text-xs font-mono rounded-lg transition-colors ${
            btn.isActive
              ? 'bg-ink text-white shadow-sm'
              : 'text-muted-foreground hover:text-ink hover:bg-warm/80'
          }`}
        >
          {btn.label}
        </button>
      ))}
    </div>
  )
}
