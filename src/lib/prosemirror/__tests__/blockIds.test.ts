import { describe, it, expect } from 'vitest'
import { EditorState, TextSelection, Plugin } from 'prosemirror-state'
import { Node as PMNode, Schema, NodeSpec, MarkSpec } from 'prosemirror-model'
import { nodes as basicNodes, marks as basicMarks } from 'prosemirror-schema-basic'
import { addListNodes } from 'prosemirror-schema-list'
import OrderedMap from 'orderedmap'
import { splitBlock } from 'prosemirror-commands'
import { history, undo, redo } from 'prosemirror-history'
import { schema } from '../schema'
import { createBlockIdPlugin } from '../plugins/blockIdPlugin'
import {
  collectBlocks,
  collectTextblocks,
  findBlockById,
  blockIdAtPos,
  computeBlockIdFixes,
  blockTextRange,
} from '../blockIds'

function makeCounterGenId(prefix = 'id'): () => string {
  let n = 0
  return () => `${prefix}-${++n}`
}

function p(text: string, blockId: string | null = null): PMNode {
  return schema.node('paragraph', { blockId }, text ? [schema.text(text)] : [])
}

function docOf(...blocks: PMNode[]): PMNode {
  return schema.node('doc', null, blocks)
}

function stateWith(doc: PMNode, plugins: Plugin[] = [createBlockIdPlugin()]): EditorState {
  return EditorState.create({ schema, doc, plugins })
}

/** Apply a transaction and let appendTransaction run (mirrors EditorView dispatch). */
function apply(state: EditorState, buildTr: (s: EditorState) => import('prosemirror-state').Transaction) {
  return state.applyTransaction(buildTr(state))
}

describe('schema blockId attr', () => {
  it('all five block types accept a blockId attr with null default', () => {
    for (const name of ['paragraph', 'heading', 'blockquote', 'code_block', 'list_item']) {
      expect(schema.nodes[name].spec.attrs?.blockId).toEqual({ default: null })
    }
  })

  it('toDOM renders data-block-id when set and omits it when null', () => {
    const withId = schema.node('paragraph', { blockId: 'abc' }, [schema.text('hi')])
    const withoutId = schema.node('paragraph', null, [schema.text('hi')])
    const specWith = schema.nodes.paragraph.spec.toDOM!(withId) as readonly unknown[]
    const specWithout = schema.nodes.paragraph.spec.toDOM!(withoutId) as readonly unknown[]
    expect(specWith[1]).toMatchObject({ 'data-block-id': 'abc' })
    expect(JSON.stringify(specWithout)).not.toContain('data-block-id')
  })

  it('code_block nested DOMOutputSpec gets the attr on the outer tag', () => {
    const node = schema.node('code_block', { blockId: 'code-1' }, [schema.text('x')])
    const spec = schema.nodes.code_block.spec.toDOM!(node) as readonly unknown[]
    expect(spec[0]).toBe('pre')
    expect(spec[1]).toMatchObject({ 'data-block-id': 'code-1' })
  })

  it('parseDOM does not read data-block-id (pasted blocks arrive with null)', () => {
    const rules = schema.nodes.paragraph.spec.parseDOM ?? []
    for (const rule of rules) {
      expect('getAttrs' in rule && rule.getAttrs).toBeFalsy()
    }
  })

  it('heading keeps its level attr alongside blockId', () => {
    const h = schema.node('heading', { level: 2, blockId: 'h-1' }, [schema.text('t')])
    expect(h.attrs.level).toBe(2)
    expect(h.attrs.blockId).toBe('h-1')
  })
})

describe('computeBlockIdFixes', () => {
  it('assigns ids to every unstamped block across all five types', () => {
    const doc = schema.node('doc', null, [
      p('para'),
      schema.node('heading', { level: 1 }, [schema.text('head')]),
      schema.node('blockquote', null, [p('quoted')]),
      schema.node('code_block', null, [schema.text('code')]),
      schema.node('bullet_list', null, [schema.node('list_item', null, [p('item')])]),
    ])
    const fixes = computeBlockIdFixes(doc, makeCounterGenId())
    // paragraph, heading, blockquote, inner paragraph, code_block, list_item, item paragraph
    expect(fixes).toHaveLength(7)
    const ids = fixes.map((f) => f.attrs.blockId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('reassigns duplicates, first-in-document-order keeps its id', () => {
    const doc = docOf(p('first', 'dup'), p('second', 'dup'), p('third', 'unique'))
    const fixes = computeBlockIdFixes(doc, makeCounterGenId('fresh'))
    expect(fixes).toHaveLength(1)
    expect(fixes[0].attrs.blockId).toBe('fresh-1')
    expect(fixes[0].pos).toBe(doc.child(0).nodeSize) // position of the second paragraph
  })

  it('is idempotent: a fully stamped doc yields no fixes', () => {
    const doc = docOf(p('a', 'id-a'), p('b', 'id-b'))
    expect(computeBlockIdFixes(doc)).toHaveLength(0)
  })

  it('retries genId until the id is unseen (collision with an existing id)', () => {
    const doc = docOf(p('one', 'taken'), p('two'))
    const seq = ['taken', 'taken', 'fresh'] // collides twice with the stamped block
    let i = 0
    const fixes = computeBlockIdFixes(doc, () => seq[i++] ?? `overflow-${i}`)
    expect(fixes).toHaveLength(1)
    expect(fixes[0].attrs.blockId).toBe('fresh')
  })

  it('retries genId when it repeats an id it just minted in the same pass', () => {
    const doc = docOf(p('one'), p('two'))
    const seq = ['gen-1', 'gen-1', 'gen-2'] // generator repeats itself
    let i = 0
    const fixes = computeBlockIdFixes(doc, () => seq[i++] ?? `overflow-${i}`)
    const ids = fixes.map((f) => f.attrs.blockId)
    expect(ids).toEqual(['gen-1', 'gen-2'])
  })

  it('preserves other attrs when fixing (heading level)', () => {
    const doc = schema.node('doc', null, [
      schema.node('heading', { level: 3 }, [schema.text('h')]),
    ])
    const fixes = computeBlockIdFixes(doc, makeCounterGenId())
    expect(fixes[0].attrs.level).toBe(3)
  })
})

describe('blockIdPlugin', () => {
  it('stamps unstamped blocks on any doc change', () => {
    const state = stateWith(docOf(p('hello')))
    const result = apply(state, (s) => s.tr.insertText('!', 6))
    expect(result.transactions.length).toBe(2) // user tr + stamping tr
    const blocks = collectBlocks(result.state.doc)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].blockId).toBeTruthy()
  })

  it('does not append on a fully stamped doc (idempotence)', () => {
    const stamped = stateWith(docOf(p('hello', 'id-1')))
    const result = apply(stamped, (s) => s.tr.insertText('!', 6))
    expect(result.transactions.length).toBe(1)
  })

  it('splitting a paragraph yields two distinct ids, first keeps the original', () => {
    let state = stateWith(docOf(p('hello world', 'orig')), [history(), createBlockIdPlugin()])
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 6)))
    splitBlock(state, (tr) => {
      state = state.apply(tr)
    })
    const blocks = collectBlocks(state.doc)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].blockId).toBe('orig')
    expect(blocks[1].blockId).toBeTruthy()
    expect(blocks[1].blockId).not.toBe('orig')
  })

  it('undo restores the pre-split doc and id; redo re-mints distinct ids', () => {
    let state = stateWith(docOf(p('hello world', 'orig')), [history(), createBlockIdPlugin()])
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 6)))
    splitBlock(state, (tr) => {
      state = state.apply(tr)
    })
    expect(collectBlocks(state.doc)).toHaveLength(2)

    undo(state, (tr) => {
      state = state.apply(tr)
    })
    const afterUndo = collectBlocks(state.doc)
    expect(afterUndo).toHaveLength(1)
    expect(afterUndo[0].blockId).toBe('orig')

    redo(state, (tr) => {
      state = state.apply(tr)
    })
    const afterRedo = collectBlocks(state.doc)
    expect(afterRedo).toHaveLength(2)
    expect(afterRedo[0].blockId).toBe('orig')
    expect(afterRedo[1].blockId).toBeTruthy()
    expect(afterRedo[1].blockId).not.toBe('orig')
  })

  it('merging two stamped paragraphs keeps the first id and appends no restamp transaction', () => {
    const state = stateWith(docOf(p('one', 'id-1'), p('two', 'id-2')))
    const boundary = state.doc.child(0).nodeSize // position between the two paragraphs
    const result = apply(state, (s) => s.tr.join(boundary))
    // No duplicate/null ids after the merge, so the plugin must stay silent.
    expect(result.transactions).toHaveLength(1)
    const blocks = collectBlocks(result.state.doc)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].blockId).toBe('id-1')
    expect(blocks[0].node.textContent).toBe('onetwo')
  })

  it('legacy JSON without blockId loads with null defaults and gets stamped on first change', () => {
    const legacyJson = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'legacy' }] },
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'title' }] },
      ],
    }
    const doc = PMNode.fromJSON(schema, legacyJson)
    expect(collectBlocks(doc).every((b) => b.blockId === null)).toBe(true)

    const state = stateWith(doc)
    const result = apply(state, (s) => s.tr.insertText('!', 7))
    expect(collectBlocks(result.state.doc).every((b) => b.blockId !== null)).toBe(true)
  })
})

describe('forward compatibility', () => {
  it('blockId-bearing JSON loads without throwing in a schema lacking the attr', () => {
    const nodesMap =
      basicNodes instanceof OrderedMap
        ? basicNodes
        : OrderedMap.from(basicNodes as unknown as Record<string, NodeSpec>)
    const oldSchema = new Schema({
      nodes: addListNodes(nodesMap, 'paragraph block*', 'block'),
      marks:
        basicMarks instanceof OrderedMap
          ? basicMarks
          : OrderedMap.from(basicMarks as unknown as Record<string, MarkSpec>),
    })
    const newJson = docOf(p('text', 'some-id')).toJSON()
    expect(() => PMNode.fromJSON(oldSchema, newJson)).not.toThrow()
  })
})

describe('lookup helpers', () => {
  const doc = docOf(p('alpha', 'b1'), p('the phrase repeats here', 'b2'), p('the phrase repeats here', 'b3'))

  it('findBlockById locates the right block', () => {
    const found = findBlockById(doc, 'b3')
    expect(found).not.toBeNull()
    expect(found!.node.textContent).toBe('the phrase repeats here')
    expect(found!.pos).toBeGreaterThan(findBlockById(doc, 'b2')!.pos)
  })

  it('blockIdAtPos resolves the innermost stamped ancestor', () => {
    const b2 = findBlockById(doc, 'b2')!
    expect(blockIdAtPos(doc, b2.pos + 3)).toBe('b2')
  })

  it('blockIdAtPos resolves list item ids over inner paragraph when paragraph unstamped', () => {
    const listDoc = schema.node('doc', null, [
      schema.node('bullet_list', null, [
        schema.node('list_item', { blockId: 'li-1' }, [p('item text')]),
      ]),
    ])
    const inner = findBlockById(listDoc, 'li-1')!
    expect(blockIdAtPos(listDoc, inner.pos + 3)).toBe('li-1')
  })

  it('blockIdAtPos: doc-level boundaries resolve to null; out-of-range positions clamp safely', () => {
    const doc = docOf(p('alpha', 'b1'))
    expect(blockIdAtPos(doc, 0)).toBeNull() // before the first block: no block ancestor
    expect(blockIdAtPos(doc, doc.content.size)).toBeNull() // after the last block
    expect(blockIdAtPos(doc, 1)).toBe('b1') // first position inside the block
    expect(() => blockIdAtPos(doc, -10)).not.toThrow()
    expect(() => blockIdAtPos(doc, 99999)).not.toThrow()
    expect(blockIdAtPos(doc, -10)).toBeNull()
    expect(blockIdAtPos(doc, 99999)).toBeNull()
  })

  it('collectTextblocks excludes wrapper nodes', () => {
    const listDoc = schema.node('doc', null, [
      schema.node('blockquote', { blockId: 'bq' }, [p('quoted', 'p-in-bq')]),
    ])
    const names = collectTextblocks(listDoc).map((b) => b.node.type.name)
    expect(names).toEqual(['paragraph'])
  })
})

describe('blockTextRange', () => {
  it('disambiguates a repeated phrase by block (findTextInDoc cannot)', () => {
    const doc = docOf(p('the phrase', 'b1'), p('the phrase', 'b2'))
    const inB2 = blockTextRange(doc, 'b2', 'the phrase')
    const b2 = findBlockById(doc, 'b2')!
    expect(inB2).not.toBeNull()
    expect(inB2!.from).toBeGreaterThan(b2.pos)
    expect(inB2!.to).toBeLessThanOrEqual(b2.pos + b2.node.nodeSize)
    expect(doc.textBetween(inB2!.from, inB2!.to)).toBe('the phrase')
  })

  it('matches text spanning mark boundaries within a block', () => {
    const marked = schema.node('paragraph', { blockId: 'm1' }, [
      schema.text('plain '),
      schema.text('bold', [schema.marks.strong.create()]),
      schema.text(' tail'),
    ])
    const doc = docOf(marked)
    const range = blockTextRange(doc, 'm1', 'plain bold tail')
    expect(range).not.toBeNull()
    expect(doc.textBetween(range!.from, range!.to)).toBe('plain bold tail')
  })

  it('searches inside wrapper blocks per textblock', () => {
    const doc = schema.node('doc', null, [
      schema.node('blockquote', { blockId: 'bq' }, [p('first inner'), p('second inner')]),
    ])
    const range = blockTextRange(doc, 'bq', 'second inner')
    expect(range).not.toBeNull()
    expect(doc.textBetween(range!.from, range!.to)).toBe('second inner')
  })

  it('does not match across textblock boundaries inside a wrapper', () => {
    const doc = schema.node('doc', null, [
      schema.node('blockquote', { blockId: 'bq' }, [p('ends here'), p('starts now')]),
    ])
    expect(blockTextRange(doc, 'bq', 'herestarts')).toBeNull()
  })

  it('returns null for unknown block or missing text', () => {
    const doc = docOf(p('text', 'b1'))
    expect(blockTextRange(doc, 'nope', 'text')).toBeNull()
    expect(blockTextRange(doc, 'b1', 'absent')).toBeNull()
    expect(blockTextRange(doc, 'b1', '')).toBeNull()
  })

  it('matches the entire block text at exact node boundaries', () => {
    const doc = docOf(p('alpha', 'b1'), p('beta', 'b2'))
    const b2 = findBlockById(doc, 'b2')!
    const range = blockTextRange(doc, 'b2', 'beta')
    expect(range).not.toBeNull()
    expect(range!.from).toBe(b2.pos + 1) // first content position
    expect(range!.to).toBe(b2.pos + b2.node.nodeSize - 1) // last content position
  })

  describe('hard_break handling', () => {
    const withBreak = schema.node('paragraph', { blockId: 'hb' }, [
      schema.text('line one'),
      schema.node('hard_break'),
      schema.text('line two'),
    ])

    it('never matches a query spanning the break (concatenated text, non-contiguous positions)', () => {
      const doc = docOf(withBreak)
      // Concatenated block text is "line oneline two" — these only exist across the break.
      expect(blockTextRange(doc, 'hb', 'oneline')).toBeNull()
      expect(blockTextRange(doc, 'hb', 'e onel')).toBeNull()
    })

    it('matches after the break at positions that account for the leaf node', () => {
      const doc = docOf(withBreak)
      const range = blockTextRange(doc, 'hb', 'line two')
      expect(range).not.toBeNull()
      expect(doc.textBetween(range!.from, range!.to)).toBe('line two')
    })

    it('skips a first occurrence that spans the break and returns a later contiguous one', () => {
      const doc = docOf(
        schema.node('paragraph', { blockId: 'rt' }, [
          schema.text('end x'),
          schema.node('hard_break'),
          schema.text('x endx end'),
        ]),
      )
      // Concatenated text "end xx endx end": "x end" first occurs across the
      // break (idx 4), then contiguously inside the second text node (idx 5).
      const range = blockTextRange(doc, 'rt', 'x end')
      expect(range).not.toBeNull()
      expect(doc.textBetween(range!.from, range!.to)).toBe('x end')
      const para = findBlockById(doc, 'rt')!
      const breakPos = para.pos + 1 + 'end x'.length
      expect(range!.from).toBeGreaterThan(breakPos) // landed after the break
    })
  })
})
