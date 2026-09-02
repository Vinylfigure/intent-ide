import { EditorState } from 'prosemirror-state'
import { Node } from 'prosemirror-model'
import type { Scope } from '@/lib/annotations/types'
import { inferScopeFromText } from '@/lib/annotations/selectionOffers'

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

  // No document structure to key off of here — same text-only heuristic
  // used when scoring a selection made outside the editor (selectionOffers.ts).
  return inferScopeFromText(text)
}

// Get the text content of the block containing a position. The position is
// clamped to the document (mirroring answerBreakpointPos in answerReveal.ts):
// stored anchors can outlive a shrinking doc, and an unclamped resolve would
// throw a RangeError. A clamped position that lands between blocks (depth 0)
// has no containing block — return '' rather than the whole document.
export function getBlockText(state: EditorState, pos: number): string {
  const clamped = Math.max(0, Math.min(pos, state.doc.content.size))
  const $pos = state.doc.resolve(clamped)
  if ($pos.depth === 0) return ''
  const start = $pos.start($pos.depth)
  const end = $pos.end($pos.depth)
  // Same separator rule as getSectionText: a block containing nested content
  // (a table cell, a list item) must not have its parts concatenated blind.
  return state.doc.textBetween(start, end, '\n\n', ' ')
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

  // Separators matter more than they look. textBetween's default joins blocks
  // with NOTHING, so a heading and the paragraph under it arrive as
  // `...Atlantis "sniff test"The stated process was IaC...` — and the resolver
  // then collapses whitespace on top of that. A small local model reads the
  // run-on as one malformed sentence, which is a grounding failure disguised
  // as a formatting one.
  return state.doc.textBetween(sectionStart, sectionEnd, '\n\n', ' ')
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
