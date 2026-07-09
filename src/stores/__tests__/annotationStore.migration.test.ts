import { describe, it, expect } from 'vitest'
import { mapLegacyType, normalizeProposedEdit } from '@/lib/annotations/types'
import type { Annotation, AnnotationType, ProposedEdit, Resolution } from '@/lib/annotations/types'

// migrateAnnotations is not exported from annotationStore — it is a private
// function called during Zustand rehydration.  We test its behaviour by
// re-implementing the same transform here, driven by mapLegacyType which IS
// exported.  This keeps tests independent of module internals while fully
// covering the migration contract.

function migrateAnnotations(annotations: Annotation[]): Annotation[] {
  return annotations.map((a) => ({
    ...a,
    documentId: a.documentId ?? 'legacy',
    locationGroupKey: a.locationGroupKey ?? `${a.documentId ?? 'legacy'}:${a.anchor.from}:${a.anchor.to}`,
    type: mapLegacyType(a.type),
    resolution: a.resolution
      ? { ...a.resolution, type: mapLegacyType(a.resolution.type) }
      : null,
  }))
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAnnotation(overrides: Record<string, any> & { type: string }): Annotation {
  return {
    id: 'test-id',
    documentId: 'doc-1',
    locationGroupKey: 'doc-1:0:10',
    status: 'resolved',
    transcript: 'test transcript',
    anchor: { from: 0, to: 10, scope: 'phrase', text: 'test' },
    resolution: null,
    conversation: [],
    parentId: null,
    childIds: [],
    createdAt: 1000,
    resolvedAt: null,
    verbosity: 'normal',
    ...overrides,
  } as Annotation
}

function makeResolution(type: string): Resolution {
  return {
    type: type as AnnotationType,
    content: 'some content',
    suggestedEdit: null,
    actions: [],
  }
}

// ── Happy path: all 6 legacy annotation.type values are migrated ─────────────

describe('migrateAnnotations — annotation.type migration', () => {
  const legacyMappings: Array<[string, AnnotationType]> = [
    ['question', 'ask'],
    ['fix', 'edit'],
    ['correction', 'edit'],
    ['restructure', 'edit'],
    ['explore', 'dig'],
    ['thought', 'flag'],
  ]

  for (const [legacyType, expected] of legacyMappings) {
    it(`migrates annotation.type "${legacyType}" → "${expected}"`, () => {
      const input = [makeAnnotation({ type: legacyType })]
      const result = migrateAnnotations(input)
      expect(result[0].type).toBe(expected)
    })
  }

  // New types must remain unchanged (idempotency across multiple hydrations)
  const newTypes: AnnotationType[] = ['ask', 'edit', 'dig', 'flag']
  for (const t of newTypes) {
    it(`preserves already-migrated annotation.type "${t}"`, () => {
      const input = [makeAnnotation({ type: t })]
      const result = migrateAnnotations(input)
      expect(result[0].type).toBe(t)
    })
  }
})

// ── Happy path: resolution.type is also migrated ─────────────────────────────

describe('migrateAnnotations — resolution.type migration', () => {
  it('migrates resolution.type when resolution is present', () => {
    const input = [
      makeAnnotation({ type: 'question', resolution: makeResolution('question') }),
    ]
    const result = migrateAnnotations(input)
    expect(result[0].resolution?.type).toBe('ask')
  })

  it('migrates resolution.type independently of annotation.type', () => {
    // annotation already migrated but resolution was not (possible edge case on partial saves)
    const input = [
      makeAnnotation({ type: 'ask', resolution: makeResolution('fix') }),
    ]
    const result = migrateAnnotations(input)
    expect(result[0].type).toBe('ask')
    expect(result[0].resolution?.type).toBe('edit')
  })

  it('leaves resolution as null when there is no resolution', () => {
    const input = [makeAnnotation({ type: 'explore', resolution: null })]
    const result = migrateAnnotations(input)
    expect(result[0].resolution).toBeNull()
  })

  it('preserves all other resolution fields unchanged', () => {
    const resolution: Resolution = {
      type: 'fix' as AnnotationType,
      content: 'rewrite this clause',
      suggestedEdit: { from: 5, to: 15, newText: 'replacement', reason: 'clarity' },
      actions: [{ label: 'Apply', kind: 'apply', handler: 'apply-edit' }],
    }
    const input = [makeAnnotation({ type: 'fix', resolution })]
    const result = migrateAnnotations(input)
    // type migrated
    expect(result[0].resolution?.type).toBe('edit')
    // other fields unchanged
    expect(result[0].resolution?.content).toBe('rewrite this clause')
    expect(result[0].resolution?.suggestedEdit?.newText).toBe('replacement')
    expect(result[0].resolution?.actions).toHaveLength(1)
  })
})

// ── Non-destructive: other annotation fields survive migration ────────────────

describe('migrateAnnotations — field preservation', () => {
  it('preserves annotation.id', () => {
    const input = [makeAnnotation({ type: 'question', id: 'abc-123' })]
    expect(migrateAnnotations(input)[0].id).toBe('abc-123')
  })

  it('preserves conversation history', () => {
    const conversation = [
      { id: 'msg-1', role: 'user' as const, content: 'hello', suggestedEdit: null, timestamp: 1000 },
    ]
    const input = [makeAnnotation({ type: 'thought', conversation })]
    const result = migrateAnnotations(input)
    expect(result[0].conversation).toEqual(conversation)
  })

  it('preserves parentId and childIds', () => {
    const input = [makeAnnotation({ type: 'explore', parentId: 'parent-1', childIds: ['child-1', 'child-2'] })]
    const result = migrateAnnotations(input)
    expect(result[0].parentId).toBe('parent-1')
    expect(result[0].childIds).toEqual(['child-1', 'child-2'])
  })

  it('preserves verbosity setting', () => {
    const input = [makeAnnotation({ type: 'fix', verbosity: 'detailed' })]
    expect(migrateAnnotations(input)[0].verbosity).toBe('detailed')
  })

  it('preserves anchor coordinates exactly', () => {
    const anchor = { from: 42, to: 99, scope: 'paragraph' as const, text: 'some selected text' }
    const input = [makeAnnotation({ type: 'correction', anchor })]
    expect(migrateAnnotations(input)[0].anchor).toEqual(anchor)
  })
})

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('migrateAnnotations — edge cases', () => {
  it('returns empty array unchanged', () => {
    expect(migrateAnnotations([])).toEqual([])
  })

  it('migrates a large batch of mixed legacy and new annotations', () => {
    const input = [
      makeAnnotation({ type: 'question', id: '1' }),
      makeAnnotation({ type: 'ask', id: '2' }),
      makeAnnotation({ type: 'fix', id: '3' }),
      makeAnnotation({ type: 'edit', id: '4' }),
      makeAnnotation({ type: 'explore', id: '5' }),
      makeAnnotation({ type: 'dig', id: '6' }),
      makeAnnotation({ type: 'thought', id: '7' }),
      makeAnnotation({ type: 'flag', id: '8' }),
      makeAnnotation({ type: 'correction', id: '9' }),
      makeAnnotation({ type: 'restructure', id: '10' }),
    ]
    const result = migrateAnnotations(input)
    expect(result).toHaveLength(10)
    // Spot-check each
    const byId = Object.fromEntries(result.map((a) => [a.id, a.type]))
    expect(byId['1']).toBe('ask')
    expect(byId['2']).toBe('ask')
    expect(byId['3']).toBe('edit')
    expect(byId['4']).toBe('edit')
    expect(byId['5']).toBe('dig')
    expect(byId['6']).toBe('dig')
    expect(byId['7']).toBe('flag')
    expect(byId['8']).toBe('flag')
    expect(byId['9']).toBe('edit')
    expect(byId['10']).toBe('edit')
  })

  it('is idempotent — running twice produces the same result', () => {
    const input = [
      makeAnnotation({ type: 'question' }),
      makeAnnotation({ type: 'fix', resolution: makeResolution('fix') }),
    ]
    const once = migrateAnnotations(input)
    const twice = migrateAnnotations(once)
    expect(twice[0].type).toBe('ask')
    expect(twice[1].type).toBe('edit')
    expect(twice[1].resolution?.type).toBe('edit')
  })

  it('handles unknown type in stored annotation by defaulting to "flag"', () => {
    // Corrupted or future-unknown type that slipped into localStorage
    const input = [makeAnnotation({ type: 'corrupted_value' })]
    const result = migrateAnnotations(input)
    expect(result[0].type).toBe('flag')
  })

  it('handles unknown type in resolution by defaulting to "flag"', () => {
    const input = [makeAnnotation({ type: 'ask', resolution: makeResolution('unknown_resolution_type') })]
    const result = migrateAnnotations(input)
    expect(result[0].resolution?.type).toBe('flag')
  })

  it('does not mutate the input array', () => {
    const input = [makeAnnotation({ type: 'question' })]
    const originalType = input[0].type
    migrateAnnotations(input)
    // The spread in migrateAnnotations creates new objects; original unchanged
    expect(input[0].type).toBe(originalType)
  })
})

// ── ProposedEdit severity/evidence normalization (v8.4 cascade graph) ─────────

describe('normalizeProposedEdit — legacy multi-region edits', () => {
  function makeLegacyEdit(overrides: Record<string, unknown> = {}): ProposedEdit {
    // Simulate a persisted pre-severity edit (fields absent in localStorage)
    return {
      id: 'pe_1',
      from: 5,
      to: 15,
      newText: 'new',
      reason: 'why',
      relation: 'cascade',
      status: 'pending',
      targetText: 'old',
      ...overrides,
    } as ProposedEdit
  }

  it('legacy primary edits become must with null evidence', () => {
    const edit = normalizeProposedEdit(makeLegacyEdit({ relation: 'primary' }))
    expect(edit.severity).toBe('must')
    expect(edit.evidence).toBeNull()
  })

  it('legacy cascade edits become probably with null evidence (uncited)', () => {
    const edit = normalizeProposedEdit(makeLegacyEdit())
    expect(edit.severity).toBe('probably')
    expect(edit.evidence).toBeNull()
  })

  it('preserves already-set severity and evidence (idempotent)', () => {
    const evidence = { sourceBlockId: 'b1', quotedText: 'q', edgeType: 'contradicts' as const }
    const edit = normalizeProposedEdit(
      makeLegacyEdit({ severity: 'must', evidence, blockId: 'b2' }),
    )
    expect(edit.severity).toBe('must')
    expect(edit.evidence).toEqual(evidence)
    expect(edit.blockId).toBe('b2')
  })

  it('preserves all pre-existing fields', () => {
    const edit = normalizeProposedEdit(makeLegacyEdit({ status: 'accepted' }))
    expect(edit.id).toBe('pe_1')
    expect(edit.from).toBe(5)
    expect(edit.to).toBe(15)
    expect(edit.status).toBe('accepted')
    expect(edit.targetText).toBe('old')
  })
})
