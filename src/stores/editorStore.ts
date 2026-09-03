'use client'

import { create } from 'zustand'
import type { EditorView } from 'prosemirror-view'
import type { EditorState } from 'prosemirror-state'
import type { Scope } from '@/lib/annotations/types'

interface ContextMenuState {
  x: number
  y: number
  from: number
  to: number
  text: string
  scope: Scope
}

interface EditorStoreState {
  view: EditorView | null
  setView: (view: EditorView | null) => void
  getState: () => EditorState | null
  contextMenu: ContextMenuState | null
  setContextMenu: (menu: ContextMenuState | null) => void
  clearContextMenu: () => void
  /**
   * The first character typed after a selection, while focus is still in the
   * editor.
   *
   * The selection bar deliberately does NOT take focus — an autofocused input
   * stole the document selection the instant you finished highlighting, which
   * is why Cmd+C copied nothing. Focus stays in the document; the first
   * printable keystroke is captured here, and the composer picks it up, focuses
   * itself, and carries on. Typing a question still costs zero clicks.
   *
   * null means "the reader has not started typing" — the state in which every
   * clipboard and caret shortcut behaves natively.
   */
  composerSeed: string | null
  setComposerSeed: (seed: string | null) => void
}

export const useEditorStore = create<EditorStoreState>()((set, get) => ({
  view: null,
  setView: (view) => set({ view }),
  getState: () => get().view?.state ?? null,
  contextMenu: null,
  // Opening a new selection bar always starts un-typed, so the next selection
  // never inherits the previous one's first keystroke.
  setContextMenu: (menu) => set({ contextMenu: menu, composerSeed: null }),
  clearContextMenu: () => set({ contextMenu: null, composerSeed: null }),
  composerSeed: null,
  setComposerSeed: (composerSeed) => set({ composerSeed }),
}))
