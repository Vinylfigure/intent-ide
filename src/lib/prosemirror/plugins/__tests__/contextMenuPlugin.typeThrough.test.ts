// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { schema } from '@/lib/prosemirror/schema'
import { useEditorStore } from '@/stores/editorStore'
import { createContextMenuPlugin } from '../contextMenuPlugin'

// The reported bug: you could not copy text out of your own document. The
// selection composer autofocused, which took the document selection the instant
// a highlight finished, so Cmd+C had nothing to copy.
//
// The fix keeps focus in the editor and captures the first printable keystroke
// instead, so typing a question still costs zero clicks. These tests pin the
// half that has to be exactly right: which keys are swallowed and which are
// handed straight back to the browser.

const plugin = createContextMenuPlugin()
const handleKeyDown = plugin.props.handleKeyDown as (
  view: EditorView,
  event: KeyboardEvent,
) => boolean

function view(): EditorView {
  const state = EditorState.create({
    schema,
    doc: schema.node('doc', null, [
      schema.node('paragraph', { blockId: 'a' }, [schema.text('Cody owns the runbook.')]),
    ]),
  })
  return { state } as unknown as EditorView
}

function key(k: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: k,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    ...mods,
  } as unknown as KeyboardEvent
}

/** The state after a highlight: bar open, nothing typed yet. */
function openBar() {
  useEditorStore.getState().setContextMenu({
    x: 0, y: 0, from: 1, to: 5, text: 'Cody', scope: 'phrase',
  })
}

beforeEach(() => {
  useEditorStore.setState({ contextMenu: null, composerSeed: null })
})

describe('contextMenuPlugin — type-through', () => {
  it('captures the first printable character and swallows it', () => {
    openBar()
    const event = key('w')
    expect(handleKeyDown(view(), event)).toBe(true)
    expect(useEditorStore.getState().composerSeed).toBe('w')
    // Swallowed on purpose: this character opens the question, it must not also
    // overwrite the passage that is currently selected.
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('lets Cmd+C through — this is the whole point', () => {
    openBar()
    const event = key('c', { metaKey: true })
    expect(handleKeyDown(view(), event)).toBe(false)
    expect(useEditorStore.getState().composerSeed).toBeNull()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('lets Ctrl+C and Alt-combinations through too', () => {
    openBar()
    for (const mods of [{ ctrlKey: true }, { altKey: true }]) {
      useEditorStore.getState().setComposerSeed(null)
      const event = key('c', mods)
      expect(handleKeyDown(view(), event)).toBe(false)
      expect(useEditorStore.getState().composerSeed).toBeNull()
    }
  })

  it('ignores non-printable keys, so caret and selection keys still work', () => {
    openBar()
    for (const k of ['ArrowRight', 'Backspace', 'Escape', 'Home', 'Tab', 'Enter']) {
      const event = key(k)
      expect(handleKeyDown(view(), event)).toBe(false)
      expect(useEditorStore.getState().composerSeed).toBeNull()
    }
  })

  it('does nothing when no selection bar is open', () => {
    const event = key('w')
    expect(handleKeyDown(view(), event)).toBe(false)
    expect(useEditorStore.getState().composerSeed).toBeNull()
  })

  it('captures only the FIRST character — the composer owns the rest', () => {
    openBar()
    handleKeyDown(view(), key('w'))
    const second = key('h')
    // Once seeded, focus has moved to the composer; the plugin must not keep
    // eating keystrokes behind it.
    expect(handleKeyDown(view(), second)).toBe(false)
    expect(useEditorStore.getState().composerSeed).toBe('w')
  })
})

describe('editorStore — seed lifecycle', () => {
  it('clears the seed when the bar closes', () => {
    openBar()
    useEditorStore.getState().setComposerSeed('w')
    useEditorStore.getState().clearContextMenu()
    expect(useEditorStore.getState().composerSeed).toBeNull()
  })

  it('does not let a new selection inherit the previous keystroke', () => {
    openBar()
    useEditorStore.getState().setComposerSeed('w')
    openBar()
    expect(useEditorStore.getState().composerSeed).toBeNull()
  })
})
