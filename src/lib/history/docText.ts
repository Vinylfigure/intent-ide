/**
 * Plain-text extraction from a stored document snapshot (ProseMirror docJson).
 * Used by the History panel to compare versions: one line per textblock,
 * blocks joined with newlines. Pure JSON walk — no schema required, so it
 * works on snapshots regardless of schema evolution.
 */

const TEXTBLOCK_TYPES = new Set(['paragraph', 'heading', 'code_block'])

interface DocJsonNode {
  type?: string
  text?: string
  content?: DocJsonNode[]
}

function inlineText(node: DocJsonNode): string {
  if (typeof node.text === 'string') return node.text
  if (Array.isArray(node.content)) return node.content.map(inlineText).join('')
  return ''
}

/** Concatenate text nodes per block, blocks separated by newlines. */
export function docJsonToText(docJson: unknown): string {
  const parsed: DocJsonNode | null =
    typeof docJson === 'string' ? safeParse(docJson) : (docJson as DocJsonNode | null)
  if (!parsed || typeof parsed !== 'object') return ''

  const lines: string[] = []
  const visit = (node: DocJsonNode) => {
    if (!node || typeof node !== 'object') return
    if (node.type && TEXTBLOCK_TYPES.has(node.type)) {
      lines.push(inlineText(node))
      return
    }
    for (const child of node.content ?? []) visit(child)
  }
  visit(parsed)

  // Fallback for snapshots with unknown block types: raw inline text.
  if (lines.length === 0) return inlineText(parsed)
  return lines.join('\n')
}

function safeParse(raw: string): DocJsonNode | null {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
