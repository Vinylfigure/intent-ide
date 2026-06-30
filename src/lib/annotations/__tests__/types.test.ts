import { describe, it, expect } from 'vitest'
import {
  mapLegacyType,
  ANNOTATION_COLORS,
  ANNOTATION_LABELS,
  ANNOTATION_DESCRIPTIONS,
} from '../types'

// ── mapLegacyType ────────────────────────────────────────────────────────────

describe('mapLegacyType — legacy 6-type → 4-type migration', () => {
  // Happy path: each legacy type maps to the documented target
  it('maps "question" → "ask"', () => {
    expect(mapLegacyType('question')).toBe('ask')
  })

  it('maps "fix" → "edit"', () => {
    expect(mapLegacyType('fix')).toBe('edit')
  })

  it('maps "correction" → "edit"', () => {
    expect(mapLegacyType('correction')).toBe('edit')
  })

  it('maps "restructure" → "edit"', () => {
    expect(mapLegacyType('restructure')).toBe('edit')
  })

  it('maps "explore" → "dig"', () => {
    expect(mapLegacyType('explore')).toBe('dig')
  })

  it('maps "thought" → "flag"', () => {
    expect(mapLegacyType('thought')).toBe('flag')
  })

  // Idempotency: new types pass through unchanged
  it('passes "ask" through unchanged', () => {
    expect(mapLegacyType('ask')).toBe('ask')
  })

  it('passes "edit" through unchanged', () => {
    expect(mapLegacyType('edit')).toBe('edit')
  })

  it('passes "dig" through unchanged', () => {
    expect(mapLegacyType('dig')).toBe('dig')
  })

  it('passes "flag" through unchanged', () => {
    expect(mapLegacyType('flag')).toBe('flag')
  })

  // Default / unknown inputs
  it('defaults unknown string to "flag"', () => {
    expect(mapLegacyType('unknown_type')).toBe('flag')
  })

  it('defaults empty string to "flag"', () => {
    expect(mapLegacyType('')).toBe('flag')
  })

  it('defaults numeric-looking string to "flag"', () => {
    expect(mapLegacyType('123')).toBe('flag')
  })

  it('is case-sensitive — uppercase does not match and defaults to "flag"', () => {
    // The switch cases are all lowercase; 'QUESTION' is not handled
    expect(mapLegacyType('QUESTION')).toBe('flag')
    expect(mapLegacyType('Fix')).toBe('flag')
  })

  it('handles whitespace-padded strings as unknown → "flag"', () => {
    expect(mapLegacyType(' question')).toBe('flag')
    expect(mapLegacyType('fix ')).toBe('flag')
  })

  // Security: XSS payload in type should default to 'flag', not throw
  it('handles XSS payload string without throwing', () => {
    expect(() => mapLegacyType('<script>alert(1)</script>')).not.toThrow()
    expect(mapLegacyType('<script>alert(1)</script>')).toBe('flag')
  })

  // Exhaustive coverage: all 6 legacy types are accounted for
  it('covers all 6 documented legacy types', () => {
    const legacyTypes = ['question', 'fix', 'correction', 'restructure', 'explore', 'thought']
    const expectedMappings: Record<string, string> = {
      question: 'ask',
      fix: 'edit',
      correction: 'edit',
      restructure: 'edit',
      explore: 'dig',
      thought: 'flag',
    }
    for (const t of legacyTypes) {
      expect(mapLegacyType(t)).toBe(expectedMappings[t])
    }
  })

  // Three legacy types converge on 'edit' — none should collide with 'ask', 'dig', or 'flag'
  it('maps three distinct legacy types to "edit"', () => {
    expect(mapLegacyType('fix')).toBe('edit')
    expect(mapLegacyType('correction')).toBe('edit')
    expect(mapLegacyType('restructure')).toBe('edit')
  })
})

// ── ANNOTATION_COLORS ────────────────────────────────────────────────────────

describe('ANNOTATION_COLORS', () => {
  it('has a color entry for every new type', () => {
    expect(ANNOTATION_COLORS).toHaveProperty('ask')
    expect(ANNOTATION_COLORS).toHaveProperty('edit')
    expect(ANNOTATION_COLORS).toHaveProperty('dig')
    expect(ANNOTATION_COLORS).toHaveProperty('flag')
  })

  it('colors are non-empty strings', () => {
    for (const color of Object.values(ANNOTATION_COLORS)) {
      expect(typeof color).toBe('string')
      expect(color.length).toBeGreaterThan(0)
    }
  })

  it('has exactly 4 color entries (no legacy type residue)', () => {
    expect(Object.keys(ANNOTATION_COLORS)).toHaveLength(4)
  })
})

// ── ANNOTATION_LABELS ────────────────────────────────────────────────────────

describe('ANNOTATION_LABELS', () => {
  it('has a label for every new type', () => {
    expect(ANNOTATION_LABELS).toHaveProperty('ask')
    expect(ANNOTATION_LABELS).toHaveProperty('edit')
    expect(ANNOTATION_LABELS).toHaveProperty('dig')
    expect(ANNOTATION_LABELS).toHaveProperty('flag')
  })

  it('has exactly 4 label entries (no legacy type residue)', () => {
    expect(Object.keys(ANNOTATION_LABELS)).toHaveLength(4)
  })
})

// ── ANNOTATION_DESCRIPTIONS ──────────────────────────────────────────────────

describe('ANNOTATION_DESCRIPTIONS', () => {
  it('has a description for every new type', () => {
    expect(ANNOTATION_DESCRIPTIONS).toHaveProperty('ask')
    expect(ANNOTATION_DESCRIPTIONS).toHaveProperty('edit')
    expect(ANNOTATION_DESCRIPTIONS).toHaveProperty('dig')
    expect(ANNOTATION_DESCRIPTIONS).toHaveProperty('flag')
  })

  it('descriptions are non-empty strings', () => {
    for (const desc of Object.values(ANNOTATION_DESCRIPTIONS)) {
      expect(typeof desc).toBe('string')
      expect(desc.length).toBeGreaterThan(0)
    }
  })

  it('has exactly 4 description entries (no legacy type residue)', () => {
    expect(Object.keys(ANNOTATION_DESCRIPTIONS)).toHaveLength(4)
  })
})
