import { Node as PMNode, Attrs } from 'prosemirror-model'
import { generateId } from '@/lib/utils/id'
import { BLOCK_ID_NODE_NAMES } from './schema'

/** Node type names that carry a `blockId` attr. */
export const BLOCK_ID_TYPES: ReadonlySet<string> = new Set(BLOCK_ID_NODE_NAMES)

export interface BlockRef {
  blockId: string | null
  pos: number
  node: PMNode
}

/** All blockId-bearing blocks in document order (includes wrappers like blockquote/list_item). */
export function collectBlocks(doc: PMNode): BlockRef[] {
  const out: BlockRef[] = []
  doc.descendants((node, pos) => {
    if (BLOCK_ID_TYPES.has(node.type.name)) {
      out.push({ blockId: (node.attrs.blockId as string | null) ?? null, pos, node })
    }
    return true
  })
  return out
}

/**
 * Only textblock leaves (paragraph, heading, code_block) — the unit the doc graph
 * and cascade payloads use, so wrapper nodes never double-count their text.
 */
export function collectTextblocks(doc: PMNode): BlockRef[] {
  return collectBlocks(doc).filter((b) => b.node.isTextblock)
}

export function findBlockById(
  doc: PMNode,
  blockId: string,
): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (BLOCK_ID_TYPES.has(node.type.name) && node.attrs.blockId === blockId) {
      found = { node, pos }
      return false
    }
    return true
  })
  return found
}

/** Innermost blockId-bearing ancestor at a document position (null if unstamped). */
export function blockIdAtPos(doc: PMNode, pos: number): string | null {
  const clamped = Math.max(0, Math.min(pos, doc.content.size))
  const $pos = doc.resolve(clamped)
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth)
    if (BLOCK_ID_TYPES.has(node.type.name)) {
      const id = node.attrs.blockId as string | null
      if (id) return id
    }
  }
  return null
}

export interface BlockIdFix {
  pos: number
  attrs: Attrs
}

/**
 * One pass over the doc: any block whose id is null OR already seen gets a fresh id.
 * First-in-document-order keeps its id — splitting a paragraph therefore leaves the
 * top half's identity intact and mints a new id for the bottom half.
 */
export function computeBlockIdFixes(
  doc: PMNode,
  genId: () => string = generateId,
): BlockIdFix[] {
  const seen = new Set<string>()
  const fixes: BlockIdFix[] = []
  doc.descendants((node, pos) => {
    if (!BLOCK_ID_TYPES.has(node.type.name)) return true
    const id = node.attrs.blockId as string | null
    if (id && !seen.has(id)) {
      seen.add(id)
      return true
    }
    let fresh = genId()
    while (seen.has(fresh)) fresh = genId()
    seen.add(fresh)
    fixes.push({ pos, attrs: { ...node.attrs, blockId: fresh } })
    return true
  })
  return fixes
}

/**
 * Locate `query` inside the block with `blockId`, spanning marks (bold/italic split
 * text nodes but positions stay contiguous). Unlike `findTextInDoc`, this
 * disambiguates repeated phrases by block and can match across mark boundaries.
 * Matches never span non-text leaves (hard_break, image) or textblock boundaries.
 */
export function blockTextRange(
  doc: PMNode,
  blockId: string,
  query: string,
): { from: number; to: number } | null {
  if (!query) return null
  const found = findBlockById(doc, blockId)
  if (!found) return null

  const textblocks: Array<{ node: PMNode; pos: number }> = []
  if (found.node.isTextblock) {
    textblocks.push(found)
  } else {
    found.node.descendants((child, childPos) => {
      if (child.isTextblock) {
        textblocks.push({ node: child, pos: found.pos + 1 + childPos })
        return false
      }
      return true
    })
  }

  for (const tb of textblocks) {
    const range = textblockRange(tb.node, tb.pos, query)
    if (range) return range
  }
  return null
}

function textblockRange(
  node: PMNode,
  pos: number,
  query: string,
): { from: number; to: number } | null {
  let text = ''
  const posOfChar: number[] = []
  node.forEach((child, offset) => {
    if (child.isText && child.text) {
      for (let i = 0; i < child.text.length; i++) posOfChar.push(pos + 1 + offset + i)
      text += child.text
    }
  })
  let idx = text.indexOf(query)
  while (idx !== -1) {
    const from = posOfChar[idx]
    const last = posOfChar[idx + query.length - 1]
    // Contiguity check: a match interrupted by a non-text leaf is not a real range.
    if (last - from === query.length - 1) return { from, to: last + 1 }
    idx = text.indexOf(query, idx + 1)
  }
  return null
}
