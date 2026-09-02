import { describe, it, expect } from 'vitest'
import { migrateTableBlocks } from '@/lib/docInput/migrateTableBlocks'
import { parseTextToDoc } from '@/lib/docInput/parser'
import { schema } from '@/lib/prosemirror/schema'
import { Node } from 'prosemirror-model'

// The old parser turned every GFM table into a code_block holding the raw pipe
// text. These fixtures reproduce that exact shape.

function codeBlockDoc(text: string, blockId?: string) {
  return {
    type: 'doc',
    content: [
      {
        type: 'code_block',
        ...(blockId ? { attrs: { blockId } } : {}),
        content: [{ type: 'text', text }],
      },
    ],
  }
}

/** Collect every node type present in a serialized doc. */
function typesIn(docJson: unknown): string[] {
  const seen: string[] = []
  const walk = (n: { type?: string; content?: unknown[] }) => {
    if (n.type) seen.push(n.type)
    if (Array.isArray(n.content)) n.content.forEach((c) => walk(c as typeof n))
  }
  walk(docJson as { type?: string; content?: unknown[] })
  return seen
}

const SIMPLE_TABLE = ['| Area | Gap |', '| :---- | :---- |', '| GCP | Breadth |'].join('\n')

describe('migrateTableBlocks — recovery', () => {
  it('converts a legacy table-as-code_block into a real table', () => {
    const { doc, converted } = migrateTableBlocks(codeBlockDoc(SIMPLE_TABLE))
    expect(converted).toBe(1)
    const types = typesIn(doc)
    expect(types).toContain('table')
    expect(types).not.toContain('code_block')
  })

  it('preserves every cell\'s text through the conversion', () => {
    const { doc } = migrateTableBlocks(codeBlockDoc(SIMPLE_TABLE))
    const node = Node.fromJSON(schema, doc as Parameters<typeof Node.fromJSON>[1])
    // textBetween with a separator keeps cells from running together.
    const text = node.textBetween(0, node.content.size, ' ')
    for (const cell of ['Area', 'Gap', 'GCP', 'Breadth']) {
      expect(text).toContain(cell)
    }
  })

  it('recovers the single-cell callout tables a Google Docs export produces', () => {
    // The shape that actually broke: one header cell, a delimiter row, no body.
    const callout = ['| A strong answer: production history is heavier in AWS. |', '| :---- |'].join('\n')
    const { doc, converted } = migrateTableBlocks(codeBlockDoc(callout))
    expect(converted).toBe(1)
    expect(typesIn(doc)).toContain('table')
  })

  it('carries the blockId onto the table so existing anchors still resolve', () => {
    // blockId is document identity — annotations, the doc graph and the audit
    // trail all key off it. Losing it would orphan every annotation on the block.
    const { doc } = migrateTableBlocks(codeBlockDoc(SIMPLE_TABLE, 'blk-42'))
    const table = (doc as { content: { type: string; attrs?: Record<string, unknown> }[] }).content[0]
    expect(table.type).toBe('table')
    expect(table.attrs?.blockId).toBe('blk-42')
  })

  it('converts every table in a document, not just the first', () => {
    const many = {
      type: 'doc',
      content: [
        { type: 'code_block', content: [{ type: 'text', text: SIMPLE_TABLE }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Between them.' }] },
        { type: 'code_block', content: [{ type: 'text', text: SIMPLE_TABLE }] },
      ],
    }
    expect(migrateTableBlocks(many).converted).toBe(2)
  })

  it('produces a document the schema accepts', () => {
    const { doc } = migrateTableBlocks(codeBlockDoc(SIMPLE_TABLE))
    expect(() => Node.fromJSON(schema, doc as Parameters<typeof Node.fromJSON>[1])).not.toThrow()
  })
})

describe('migrateTableBlocks — what it must refuse to touch', () => {
  it('leaves a real code sample alone even when it contains pipes', () => {
    const code = ['const a = x | y', 'if (a) { run() }'].join('\n')
    const input = codeBlockDoc(code)
    const { doc, converted } = migrateTableBlocks(input)
    expect(converted).toBe(0)
    expect(doc).toBe(input)
  })

  it('leaves a code sample containing a horizontal rule alone', () => {
    // The cheap delimiter-row pre-check must not fire on ordinary dashes.
    const code = ['# ----------------', 'run --flag'].join('\n')
    expect(migrateTableBlocks(codeBlockDoc(code)).converted).toBe(0)
  })

  it('refuses a block holding a table plus trailing prose', () => {
    // A partial parse means converting would silently discard the remainder.
    const mixed = [SIMPLE_TABLE, '', 'Trailing note that is not part of the table.'].join('\n')
    expect(migrateTableBlocks(codeBlockDoc(mixed)).converted).toBe(0)
  })

  it('refuses a header/delimiter mismatch rather than guessing', () => {
    const ragged = ['| A | B |', '| :---- |', '| 1 | 2 |'].join('\n')
    expect(migrateTableBlocks(codeBlockDoc(ragged)).converted).toBe(0)
  })

  it('leaves paragraphs and headings untouched', () => {
    const plain = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body | with a pipe' }] },
      ],
    }
    const { doc, converted } = migrateTableBlocks(plain)
    expect(converted).toBe(0)
    expect(doc).toBe(plain)
  })
})

describe('migrateTableBlocks — safety', () => {
  it('is idempotent — a second pass converts nothing', () => {
    const once = migrateTableBlocks(codeBlockDoc(SIMPLE_TABLE))
    const twice = migrateTableBlocks(once.doc)
    expect(twice.converted).toBe(0)
    expect(twice.doc).toBe(once.doc)
  })

  it('returns the same reference when nothing converts, so callers can skip a re-render', () => {
    const input = codeBlockDoc('plain text, no table here')
    expect(migrateTableBlocks(input).doc).toBe(input)
  })

  it('never throws on malformed input', () => {
    for (const bad of [null, undefined, 42, 'a string', {}, { type: 'doc' }, { content: 'nope' }]) {
      expect(() => migrateTableBlocks(bad)).not.toThrow()
      expect(migrateTableBlocks(bad).converted).toBe(0)
    }
  })

  it('does not convert a document the live parser already imports correctly', () => {
    // Regression guard on the pair: what parseTextToDoc produces today must
    // have nothing left for the migration to find.
    const fresh = parseTextToDoc(`# Heading\n\n${SIMPLE_TABLE}\n`).toJSON()
    expect(typesIn(fresh)).toContain('table')
    expect(migrateTableBlocks(fresh).converted).toBe(0)
  })
})
