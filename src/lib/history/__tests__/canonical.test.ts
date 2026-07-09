import { describe, expect, it } from 'vitest'
import {
  canonicalStringify,
  commitPayload,
  computeCommitHash,
  sha256Hex,
} from '../canonical'

describe('canonicalStringify', () => {
  it('is independent of object key insertion order at every depth', () => {
    const a = { b: 1, a: { d: [1, 2], c: 'x' }, e: null }
    const b = { e: null, a: { c: 'x', d: [1, 2] }, b: 1 }
    expect(canonicalStringify(a)).toBe(canonicalStringify(b))
  })

  it('preserves array order (arrays are ordered content, not sets)', () => {
    expect(canonicalStringify([1, 2])).not.toBe(canonicalStringify([2, 1]))
  })

  it('skips undefined values like JSON.stringify does', () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  it('handles primitives and null', () => {
    expect(canonicalStringify(null)).toBe('null')
    expect(canonicalStringify('hi')).toBe('"hi"')
    expect(canonicalStringify(3)).toBe('3')
    expect(canonicalStringify(true)).toBe('true')
  })

  it('round-trips to structurally equal JSON', () => {
    const value = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'b1' } }] }
    expect(JSON.parse(canonicalStringify(value))).toEqual(value)
  })
})

describe('commitPayload', () => {
  it('normalizes string and object docJson to the same payload', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph' }] }
    expect(commitPayload(JSON.stringify(doc), 'p1', 'doc-1')).toBe(
      commitPayload(doc, 'p1', 'doc-1'),
    )
  })

  it('separates documentId, parentHash and content', () => {
    const doc = { type: 'doc' }
    expect(commitPayload(doc, null, 'doc-1')).not.toBe(commitPayload(doc, 'p1', 'doc-1'))
    expect(commitPayload(doc, null, 'doc-1')).not.toBe(commitPayload(doc, null, 'doc-2'))
  })
})

describe('computeCommitHash / sha256Hex', () => {
  it('produces a stable sha256 hex digest', async () => {
    // Known vector: sha256("abc")
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('is key-order independent for docJson', async () => {
    const h1 = await computeCommitHash({ b: 1, a: 2 }, null, 'doc-1')
    const h2 = await computeCommitHash({ a: 2, b: 1 }, null, 'doc-1')
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when the parent changes (content-addressed chain)', async () => {
    const doc = { type: 'doc' }
    const h1 = await computeCommitHash(doc, null, 'doc-1')
    const h2 = await computeCommitHash(doc, h1, 'doc-1')
    expect(h1).not.toBe(h2)
  })
})
