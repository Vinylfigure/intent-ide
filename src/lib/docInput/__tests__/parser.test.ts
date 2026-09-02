// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { DOMSerializer } from 'prosemirror-model'
import { parseHtmlToDoc, parseTextToDoc } from '../parser'
import { schema } from '@/lib/prosemirror/schema'

describe('document input tables', () => {
  it('parses a Markdown table into native header and body cells', () => {
    const doc = parseTextToDoc([
      '| Name | Status |',
      '| --- | --- |',
      '| Sierra | Ready |',
    ].join('\n'))

    expect(doc.childCount).toBe(1)
    expect(doc.firstChild?.type).toBe(schema.nodes.table)
    expect(doc.firstChild?.child(0).child(0).type).toBe(schema.nodes.table_header)
    expect(doc.firstChild?.child(1).child(0).type).toBe(schema.nodes.table_cell)
    expect(doc.textContent).toBe('NameStatusSierraReady')
    expect(doc.toJSON()).not.toMatchObject({ content: [{ type: 'code_block' }] })
  })

  it('supports optional edge pipes, escaped/code-span pipes, alignment, and inline marks', () => {
    const doc = parseTextToDoc([
      'Item | Meaning | Result',
      ':--- | :---: | ---:',
      '**A** \\| B | `x|y` | *Done*',
    ].join('\n'))
    const table = doc.firstChild!
    const body = table.child(1)

    expect(table.child(0).child(0).attrs.align).toBe('left')
    expect(table.child(0).child(1).attrs.align).toBe('center')
    expect(table.child(0).child(2).attrs.align).toBe('right')
    expect(body.childCount).toBe(3)
    expect(body.child(0).textContent).toBe('A | B')
    expect(body.child(1).textContent).toBe('x|y')
    expect(body.child(0).firstChild?.firstChild?.marks[0]?.type).toBe(schema.marks.strong)
    expect(body.child(1).firstChild?.firstChild?.marks[0]?.type).toBe(schema.marks.code)
    expect(body.child(2).firstChild?.firstChild?.marks[0]?.type).toBe(schema.marks.em)
  })

  it('pads uneven rows and preserves cells from wider body rows', () => {
    const doc = parseTextToDoc([
      '| A | B |',
      '| --- | --- |',
      '| one |',
      '| two | three | four |',
    ].join('\n'))
    const table = doc.firstChild!

    expect(table.childCount).toBe(3)
    expect(Array.from({ length: table.childCount }, (_, row) => table.child(row).childCount)).toEqual([3, 3, 3])
    expect(table.child(1).child(2).textContent).toBe('')
    expect(table.child(2).child(2).textContent).toBe('four')
  })

  it.each([
    ['missing delimiter', '| A | B |\nplain prose'],
    ['bad delimiter', '| A | B |\n| --- | nope |'],
    ['short delimiter', '| A | B |\n| -- | --- |'],
    ['mismatched delimiter', '| A | B |\n| --- |'],
  ])('leaves %s as ordinary text', (_label, markdown) => {
    const doc = parseTextToDoc(markdown)
    let tableCount = 0
    doc.descendants((node) => {
      if (node.type === schema.nodes.table) tableCount++
    })
    expect(doc.firstChild?.type).toBe(schema.nodes.paragraph)
    expect(tableCount).toBe(0)
  })

  it('does not swallow prose after the final table row', () => {
    const doc = parseTextToDoc('| A | B |\n| --- | --- |\n| 1 | 2 |\nNext paragraph')
    expect(doc.childCount).toBe(2)
    expect(doc.child(0).type).toBe(schema.nodes.table)
    expect(doc.child(1).textContent).toBe('Next paragraph')
  })

  it('keeps pipe tables inside fenced code blocks as code', () => {
    const doc = parseTextToDoc('```md\n| A | B |\n| --- | --- |\n| 1 | 2 |\n```')
    expect(doc.firstChild?.type).toBe(schema.nodes.code_block)
    expect(doc.firstChild?.textContent).toContain('| --- | --- |')
  })

  it('parses imported HTML tables as native tables and strips scripts', () => {
    const doc = parseHtmlToDoc(`
      <table>
        <thead><tr><th>Name</th><th>Notes</th></tr></thead>
        <tbody><tr><td>Sierra</td><td>A | B<script>alert(1)</script></td></tr></tbody>
      </table>
    `)
    expect(doc.firstChild?.type).toBe(schema.nodes.table)
    expect(doc.firstChild?.child(1).child(1).textContent).toBe('A | B')
    expect(doc.textContent).not.toContain('alert')
  })

  it('round-trips table JSON and serializes semantic table elements', () => {
    const doc = parseTextToDoc('| A | B |\n| --- | ---: |\n| 1 | 2 |')
    expect(schema.nodeFromJSON(doc.toJSON()).toJSON()).toEqual(doc.toJSON())

    const container = document.createElement('div')
    container.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(doc.content))
    expect(container.querySelectorAll('table')).toHaveLength(1)
    expect(container.querySelectorAll('th')).toHaveLength(2)
    expect(container.querySelectorAll('td')).toHaveLength(2)
    expect(container.querySelector('pre')).toBeNull()
  })
})
