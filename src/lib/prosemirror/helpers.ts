import { EditorState } from 'prosemirror-state'
import { Node } from 'prosemirror-model'
import type { Scope } from '@/lib/annotations/types'

// Infer scope from a selection range
export function inferScope(state: EditorState, from: number, to: number): Scope {
  const $from = state.doc.resolve(from)
  const $to = state.doc.resolve(to)
  const text = state.doc.textBetween(from, to)

  // Check if selection includes a heading
  let hasHeading = false
  state.doc.nodesBetween(from, to, (node) => {
    if (node.type.name === 'heading') hasHeading = true
  })

  // Selection spans paragraphs or includes heading -> section
  if (hasHeading || $from.parent !== $to.parent) {
    if ($from.depth <= 1 || $to.depth <= 1) return 'section'
    return 'paragraph'
  }

  // Count sentences in selection
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0)
  if (sentences.length <= 1 && text.length < 100) return 'phrase'
  if (sentences.length === 1) return 'sentence'
  return 'paragraph'
}

// Get the text content of the block containing a position
export function getBlockText(state: EditorState, pos: number): string {
  const $pos = state.doc.resolve(pos)
  const start = $pos.start($pos.depth)
  const end = $pos.end($pos.depth)
  return state.doc.textBetween(start, end)
}

// Get the section (heading to heading) containing a position
export function getSectionText(state: EditorState, pos: number): string {
  const $pos = state.doc.resolve(pos)
  let sectionStart = 0
  let sectionEnd = state.doc.content.size

  // Walk backward to find preceding heading
  state.doc.nodesBetween(0, pos, (node, nodePos) => {
    if (node.type.name === 'heading') {
      sectionStart = nodePos
    }
  })

  // Walk forward to find next heading
  let foundNext = false
  state.doc.nodesBetween(pos, state.doc.content.size, (node, nodePos) => {
    if (node.type.name === 'heading' && nodePos > pos && !foundNext) {
      sectionEnd = nodePos
      foundNext = true
    }
  })

  return state.doc.textBetween(sectionStart, sectionEnd)
}

// Get all text content of the document
export function getDocumentText(state: EditorState): string {
  return state.doc.textContent
}

// Infer scope and metadata from the current selection
export function inferScopeFromSelection(state: EditorState): {
  from: number
  to: number
  scope: Scope
  text: string
  nodeType: string // 'heading' | 'paragraph' | 'list_item' | 'text'
} | null {
  const { from, to } = state.selection
  if (from === to) return null

  const scope = inferScope(state, from, to)
  const text = state.doc.textBetween(from, to)

  // Determine nodeType
  let nodeType: string = 'text'
  let hasHeading = false
  state.doc.nodesBetween(from, to, (node) => {
    if (node.type.name === 'heading') hasHeading = true
  })

  if (hasHeading) {
    nodeType = 'heading'
  } else {
    const $from = state.doc.resolve(from)
    const parentName = $from.parent.type.name
    if (parentName === 'list_item') {
      nodeType = 'list_item'
    } else if (parentName === 'paragraph') {
      nodeType = 'paragraph'
    }
  }

  return { from, to, scope, text, nodeType }
}
