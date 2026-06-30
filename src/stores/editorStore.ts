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
}

export const useEditorStore = create<EditorStoreState>()((set, get) => ({
  view: null,
  setView: (view) => set({ view }),
  getState: () => get().view?.state ?? null,
  contextMenu: null,
  setContextMenu: (menu) => set({ contextMenu: menu }),
  clearContextMenu: () => set({ contextMenu: null }),
}))
