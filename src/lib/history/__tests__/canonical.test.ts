import { describe, expect, it } from 'vitest'
import {
  canonicalStringify,
  commitPayload,
  computeCommitHash,
  computeContentHash,
  contentPayload,
  sha256Hex,
  type CommitHashFields,
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

describe('contentPayload / computeContentHash (the "tree")', () => {
  it('normalizes string and object docJson to the same payload', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph' }] }
    expect(contentPayload(JSON.stringify(doc))).toBe(contentPayload(doc))
  })

  it('is key-order independent', async () => {
    const h1 = await computeContentHash({ b: 1, a: 2 })
    const h2 = await computeContentHash({ a: 2, b: 1 })
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
  })

  it('covers ONLY the content — no attribution, no parent, no documentId', async () => {
    // Same doc content always yields the same tree hash, whoever committed it.
    const doc = { type: 'doc', content: [{ type: 'paragraph' }] }
    expect(await computeContentHash(doc)).toBe(await computeContentHash({ ...doc }))
  })
})

// ---------------------------------------------------------------------------
// Commit hash ("commit"): must cover attribution, not just content — this is
// the adversarial-review HIGH fix. Two commits that agree on content but
// disagree on kind/actor/auditIds must be distinct records.
// ---------------------------------------------------------------------------

function fields(over: Partial<CommitHashFields> = {}): CommitHashFields {
  return {
    documentId: 'doc-1',
    parentHash: 'p1',
    contentHash: 'c1',
    kind: 'direct',
    message: 'Edited document',
    actor: 'human',
    annotationId: null,
    auditIds: [],
    modelVersion: '',
    ...over,
  }
}

describe('commitPayload / computeCommitHash (the "commit")', () => {
  it('is deterministic for equal fields', async () => {
    expect(await computeCommitHash(fields())).toBe(await computeCommitHash(fields()))
  })

  it('changes when attribution changes even though content is identical', async () => {
    const base = await computeCommitHash(fields())
    // The confirmed collapse race: 'apply' + 'direct' on the same head/content.
    expect(await computeCommitHash(fields({ kind: 'apply' }))).not.toBe(base)
    expect(await computeCommitHash(fields({ actor: 'ai+human' }))).not.toBe(base)
    expect(await computeCommitHash(fields({ auditIds: ['a1'] }))).not.toBe(base)
    expect(await computeCommitHash(fields({ annotationId: 'ann-1' }))).not.toBe(base)
    expect(await computeCommitHash(fields({ message: 'other' }))).not.toBe(base)
    expect(await computeCommitHash(fields({ modelVersion: 'm2' }))).not.toBe(base)
  })

  it('changes when the parent or document changes (chain addressing)', async () => {
    const base = await computeCommitHash(fields())
    expect(await computeCommitHash(fields({ parentHash: 'p2' }))).not.toBe(base)
    expect(await computeCommitHash(fields({ parentHash: null }))).not.toBe(base)
    expect(await computeCommitHash(fields({ documentId: 'doc-2' }))).not.toBe(base)
    expect(await computeCommitHash(fields({ contentHash: 'c2' }))).not.toBe(base)
  })

  it('normalizes a missing annotationId to the empty string', () => {
    expect(commitPayload(fields({ annotationId: null }))).toBe(
      commitPayload(fields({ annotationId: '' })),
    )
  })

  it('is unambiguous for hostile field values (canonical JSON join, not a delimiter join)', () => {
    // A newline-delimited join would confuse these two; canonical JSON cannot.
    const a = commitPayload(fields({ message: 'x\ny', actor: 'human' }))
    const b = commitPayload(fields({ message: 'x', actor: 'y\nhuman' }))
    expect(a).not.toBe(b)
  })
})

describe('sha256Hex', () => {
  it('produces a stable sha256 hex digest', async () => {
    // Known vector: sha256("abc")
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})
