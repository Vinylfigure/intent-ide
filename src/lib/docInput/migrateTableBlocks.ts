import { Node } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'
import { parseMarkdownTable } from '@/lib/docInput/parser'

/**
 * Recover tables from documents imported before the editor had any.
 *
 * The parser used to end every table branch with, verbatim, "render table as a
 * readable code block (lightweight editor, no full table support)" — so a GFM
 * pipe table became a `code_block` holding the raw pipe text, which the editor
 * styles as light-on-near-black with a horizontal scrollbar. A 40-row grid of
 * prose renders as an unreadable dark slab.
 *
 * Native tables landed later, but nothing re-parses an existing document:
 * `documentStore` persists only `docJson`, never the markdown it came from, so
 * a document imported under the old parser keeps its code_blocks forever and
 * re-importing by hand is the only escape. This is that escape, automated.
 *
 * Recovery is exact rather than approximate: the code_block's text IS the
 * original pipe table, so it round-trips through the same
 * `parseMarkdownTable` the live import path uses. There is no second table
 * grammar to drift out of sync with.
 *
 * Deliberately conservative — a code_block is only converted when it parses
 * as ONE table that consumes the whole block. A genuine fenced code sample
 * that merely contains a pipe, a block holding a table plus trailing prose,
 * or anything the table grammar rejects is left exactly as it was. The cost of
 * a missed conversion is a dark block the user can re-import; the cost of a
 * wrong one is destroyed source code.
 */

/** A ProseMirror node in its serialized JSON form, loosely typed. */
interface JsonNode {
  type?: string
  content?: JsonNode[]
  text?: string
  attrs?: Record<string, unknown>
  [key: string]: unknown
}

/** The plain text of a serialized node, concatenating its text children. */
function jsonNodeText(node: JsonNode): string {
  if (typeof node.text === 'string') return node.text
  if (!Array.isArray(node.content)) return ''
  return node.content.map(jsonNodeText).join('')
}

/**
 * Convert one code_block to a table node, or return null to leave it alone.
 *
 * Requires the parse to consume every non-blank line of the block: a partial
 * match means the block was not purely a table, and replacing it would drop
 * whatever followed.
 */
function codeBlockAsTable(node: JsonNode): JsonNode | null {
  if (node.type !== 'code_block') return null

  const text = jsonNodeText(node)
  // Cheap reject before touching the grammar: a table needs a delimiter row.
  if (!/^\s*\|?\s*:?-{3,}/m.test(text)) return null

  const lines = text.split('\n')
  // Leading blank lines would offset the parse; a table starts at a real row.
  let start = 0
  while (start < lines.length && lines[start].trim() === '') start++

  const parsed = parseMarkdownTable(lines, start)
  if (!parsed) return null

  // Everything after the table must be blank, or this block held more than one
  // thing and converting it would silently discard the rest.
  for (let i = parsed.nextLine; i < lines.length; i++) {
    if (lines[i].trim() !== '') return null
  }

  // A blockId is document identity — annotations, the doc graph and the audit
  // trail all key off it. Carry it onto the table so anything anchored to the
  // old code_block still resolves.
  const blockId = node.attrs?.blockId
  const json = parsed.node.toJSON() as JsonNode
  if (typeof blockId === 'string') {
    json.attrs = { ...(json.attrs ?? {}), blockId }
  }
  return json
}

/** Walk the tree, converting eligible code_blocks bottom-up. */
function convertNode(node: JsonNode, counter: { n: number }): JsonNode {
  const asTable = codeBlockAsTable(node)
  if (asTable) {
    counter.n++
    return asTable
  }
  if (!Array.isArray(node.content)) return node
  return { ...node, content: node.content.map((child) => convertNode(child, counter)) }
}

/**
 * Convert every legacy table-as-code_block in a serialized document.
 *
 * Returns the input unchanged (same reference) when nothing converted, so a
 * caller can skip a re-render and a persist on the overwhelmingly common
 * already-migrated case. Idempotent: a converted document has no code_blocks
 * left for a second pass to match.
 *
 * Never throws on malformed input — a document that cannot be walked is
 * returned as-is with `converted: 0`. A migration that can fail closed on a
 * corrupt snapshot is one that can lock a user out of their own document.
 */
export function migrateTableBlocks(docJson: unknown): { doc: unknown; converted: number } {
  if (!docJson || typeof docJson !== 'object') return { doc: docJson, converted: 0 }

  const counter = { n: 0 }
  try {
    const migrated = convertNode(docJson as JsonNode, counter)
    if (counter.n === 0) return { doc: docJson, converted: 0 }

    // Validate before handing it back: a table the schema rejects would throw
    // at editor-mount time, far from here and with no way back to the original.
    Node.fromJSON(schema, migrated as Parameters<typeof Node.fromJSON>[1])
    return { doc: migrated, converted: counter.n }
  } catch {
    return { doc: docJson, converted: 0 }
  }
}
