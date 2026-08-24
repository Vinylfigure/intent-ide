import { describe, expect, it } from 'vitest'
import { computeWordDiff } from '../diffEngine'

function joined(chunks: ReturnType<typeof computeWordDiff>, side: 'before' | 'after'): string {
  const skip = side === 'before' ? 'insert' : 'delete'
  return chunks
    .filter((c) => c.type !== skip)
    .map((c) => c.text)
    .join('')
}

describe('computeWordDiff', () => {
  it('marks only the changed word inside a long sentence', () => {
    const before =
      'The Q3 budget allocates $2.4M to platform engineering, with the remainder split between growth marketing and customer success.'
    const after =
      'The Q3 budget allocates $2.8M to platform engineering, with the remainder split between growth marketing and customer success.'
    const chunks = computeWordDiff(before, after)

    const deletes = chunks.filter((c) => c.type === 'delete')
    const inserts = chunks.filter((c) => c.type === 'insert')
    expect(deletes).toEqual([{ type: 'delete', text: '$2.4M' }])
    expect(inserts).toEqual([{ type: 'insert', text: '$2.8M' }])
    // The shared prefix AND suffix survive as equal text — no repaint past the edit.
    expect(joined(chunks, 'before')).toBe(before)
    expect(joined(chunks, 'after')).toBe(after)
  })

  it('handles a pure insertion', () => {
    const chunks = computeWordDiff('alpha gamma', 'alpha beta gamma')
    expect(chunks.filter((c) => c.type === 'delete')).toEqual([])
    expect(joined(chunks, 'before')).toBe('alpha gamma')
    expect(joined(chunks, 'after')).toBe('alpha beta gamma')
    expect(chunks.some((c) => c.type === 'insert' && c.text.includes('beta'))).toBe(true)
  })

  it('handles a pure deletion', () => {
    const chunks = computeWordDiff('alpha beta gamma', 'alpha gamma')
    expect(chunks.filter((c) => c.type === 'insert')).toEqual([])
    expect(joined(chunks, 'before')).toBe('alpha beta gamma')
    expect(joined(chunks, 'after')).toBe('alpha gamma')
    expect(chunks.some((c) => c.type === 'delete' && c.text.includes('beta'))).toBe(true)
  })

  it('returns a single equal chunk for identical inputs', () => {
    const text = 'nothing changed here at all'
    expect(computeWordDiff(text, text)).toEqual([{ type: 'equal', text }])
  })

  it('handles empty sides', () => {
    expect(computeWordDiff('', '')).toEqual([])
    expect(computeWordDiff('', 'new text')).toEqual([{ type: 'insert', text: 'new text' }])
    expect(computeWordDiff('old text', '')).toEqual([{ type: 'delete', text: 'old text' }])
  })

  it('reconstructs multi-line slices exactly on both sides', () => {
    const before = 'line one\nline two\nline three'
    const after = 'line one\nline 2\nline three'
    const chunks = computeWordDiff(before, after)
    expect(joined(chunks, 'before')).toBe(before)
    expect(joined(chunks, 'after')).toBe(after)
  })
})
