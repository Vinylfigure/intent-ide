import { describe, expect, it } from 'vitest'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'
import { collectHeadings, visibleHeadingLabels } from '../documentOutline'

function h(level: number, text: string): PMNode {
  return schema.node('heading', { level }, [schema.text(text)])
}

function p(text: string): PMNode {
  return schema.node('paragraph', null, [schema.text(text)])
}

describe('collectHeadings', () => {
  it('collects headings in document order with level, text, and fraction', () => {
    const doc = schema.node('doc', null, [
      h(1, 'Title'),
      p('Intro paragraph with some words in it.'),
      h(2, 'Section one'),
      p('Body.'),
      h(3, 'Detail'),
    ])
    const headings = collectHeadings(doc)
    expect(headings.map((x) => x.text)).toEqual(['Title', 'Section one', 'Detail'])
    expect(headings.map((x) => x.level)).toEqual([1, 2, 3])
    // Positions are ascending fractions of doc length in [0, 1)
    expect(headings[0].position).toBe(0)
    for (let i = 1; i < headings.length; i++) {
      expect(headings[i].position).toBeGreaterThan(headings[i - 1].position)
      expect(headings[i].position).toBeLessThan(1)
    }
  })

  it('returns an empty list for a doc without headings', () => {
    const doc = schema.node('doc', null, [p('Just prose.')])
    expect(collectHeadings(doc)).toEqual([])
  })
})

describe('visibleHeadingLabels', () => {
  const mk = (position: number) => ({ pos: 0, level: 2, text: 'x', position })

  it('labels every heading when they are well separated', () => {
    expect(visibleHeadingLabels([mk(0), mk(0.3), mk(0.7)])).toEqual([true, true, true])
  })

  it('drops labels inside a dense run but keeps their ticks (parallel array)', () => {
    const flags = visibleHeadingLabels([mk(0.1), mk(0.11), mk(0.12), mk(0.5)], 0.04)
    expect(flags).toEqual([true, false, false, true])
    expect(flags).toHaveLength(4)
  })

  it('always labels the first heading', () => {
    expect(visibleHeadingLabels([mk(0.999)])).toEqual([true])
  })
})
