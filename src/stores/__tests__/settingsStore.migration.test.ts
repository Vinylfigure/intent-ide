import { describe, it, expect } from 'vitest'
import { normalizeClaudeModel } from '@/stores/settingsStore'

// normalizeClaudeModel maps a possibly-stale stored Claude model id to a current
// valid one.  Valid current ids pass through unchanged; any date-suffixed haiku
// alias collapses to the bare alias; everything else stale falls back to the
// safe, cheap Sonnet 4.6 default (never silently upgraded to a pricier model).

const SONNET_DEFAULT = 'claude-sonnet-4-6'

// ── Valid current ids pass through unchanged ──────────────────────────────────

describe('normalizeClaudeModel — valid current ids', () => {
  const valid = [
    'claude-opus-4-8',
    'claude-fable-5',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
    'claude-opus-4-6',
  ]

  for (const model of valid) {
    it(`passes through "${model}" unchanged`, () => {
      expect(normalizeClaudeModel(model)).toBe(model)
    })
  }

  it('preserves legacy-but-still-offered claude-opus-4-6', () => {
    // Opus 4.6 is marked "Legacy" in the picker but remains a valid id — it must
    // NOT be downgraded to the Sonnet default.
    expect(normalizeClaudeModel('claude-opus-4-6')).toBe('claude-opus-4-6')
  })
})

// ── Date-suffixed haiku aliases collapse to the bare alias ────────────────────

describe('normalizeClaudeModel — haiku date-suffix aliasing', () => {
  it('maps a date-suffixed haiku to the bare alias', () => {
    expect(normalizeClaudeModel('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5')
  })

  it('maps any claude-haiku-4-5* prefix variant to the bare alias', () => {
    expect(normalizeClaudeModel('claude-haiku-4-5-latest')).toBe('claude-haiku-4-5')
    expect(normalizeClaudeModel('claude-haiku-4-5-preview')).toBe('claude-haiku-4-5')
  })

  it('leaves the already-bare haiku alias untouched', () => {
    expect(normalizeClaudeModel('claude-haiku-4-5')).toBe('claude-haiku-4-5')
  })
})

// ── Retired / stale ids fall back to the Sonnet default ───────────────────────

describe('normalizeClaudeModel — retired/stale ids → Sonnet default', () => {
  const stale = [
    'claude-sonnet-4-5',
    'claude-3-5-sonnet-20241022',
    'claude-3-opus-20240229',
    'claude-2.1',
    'claude-sonnet-4-0',
    'gpt-4o',
    'some-garbage-model',
    '',
  ]

  for (const model of stale) {
    it(`maps stale id "${model}" → "${SONNET_DEFAULT}"`, () => {
      expect(normalizeClaudeModel(model)).toBe(SONNET_DEFAULT)
    })
  }

  it('does not upgrade a stale id to a pricier model (lands on Sonnet, not Opus/Fable)', () => {
    const result = normalizeClaudeModel('claude-3-5-sonnet-20241022')
    expect(result).toBe(SONNET_DEFAULT)
    expect(result).not.toBe('claude-opus-4-8')
    expect(result).not.toBe('claude-fable-5')
  })
})

// ── Idempotency ───────────────────────────────────────────────────────────────

describe('normalizeClaudeModel — idempotency', () => {
  it('normalizing a normalized value is stable', () => {
    const cases = ['claude-opus-4-8', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-5']
    for (const c of cases) {
      const once = normalizeClaudeModel(c)
      expect(normalizeClaudeModel(once)).toBe(once)
    }
  })
})
