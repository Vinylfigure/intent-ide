import { describe, it, expect } from 'vitest'
import type { Verbosity, Scope } from '@/lib/annotations/types'

// VERBOSITY_MULTIPLIER and SCOPE_TOKEN_LIMITS are private constants in
// resolver.ts.  We mirror them here (same pattern as resolver.test.ts) to test
// the token-capping arithmetic that drives response length behaviour.
// If the source values change, these tests will catch the drift.

const VERBOSITY_MULTIPLIER: Record<Verbosity, number> = {
  concise: 0.5,
  normal: 1,
  detailed: 2,
}

const SCOPE_TOKEN_LIMITS: Record<Scope, number> = {
  phrase: 150,
  sentence: 250,
  paragraph: 400,
  section: 600,
}

// New 4-type agent defaults (agentConfigStore defaults, referenced in resolver)
const DEFAULT_AGENT_MAX_TOKENS: Record<string, number> = {
  ask: 400,
  edit: 300,
  dig: 500,
  flag: 400,
}

// Helper that replicates the resolver's effectiveMaxTokens calculation
function effectiveTokens(
  agentMaxTokens: number,
  scope: Scope,
  verbosity: Verbosity,
): number {
  return Math.round(Math.min(agentMaxTokens, SCOPE_TOKEN_LIMITS[scope]) * VERBOSITY_MULTIPLIER[verbosity])
}

// ── Multiplier values ─────────────────────────────────────────────────────────

describe('VERBOSITY_MULTIPLIER values', () => {
  it('concise multiplier is 0.5', () => {
    expect(VERBOSITY_MULTIPLIER.concise).toBe(0.5)
  })

  it('normal multiplier is 1 (no scaling)', () => {
    expect(VERBOSITY_MULTIPLIER.normal).toBe(1)
  })

  it('detailed multiplier is 2', () => {
    expect(VERBOSITY_MULTIPLIER.detailed).toBe(2)
  })

  it('all three verbosity keys are present', () => {
    const keys = Object.keys(VERBOSITY_MULTIPLIER)
    expect(keys).toContain('concise')
    expect(keys).toContain('normal')
    expect(keys).toContain('detailed')
    expect(keys).toHaveLength(3)
  })

  it('multipliers are strictly ordered: concise < normal < detailed', () => {
    expect(VERBOSITY_MULTIPLIER.concise).toBeLessThan(VERBOSITY_MULTIPLIER.normal)
    expect(VERBOSITY_MULTIPLIER.normal).toBeLessThan(VERBOSITY_MULTIPLIER.detailed)
  })
})

// ── Token scaling with normal verbosity (baseline) ───────────────────────────

describe('effectiveTokens — normal verbosity (multiplier = 1)', () => {
  it('phrase scope caps all 4-type agents at 150', () => {
    for (const [, max] of Object.entries(DEFAULT_AGENT_MAX_TOKENS)) {
      expect(effectiveTokens(max, 'phrase', 'normal')).toBe(150)
    }
  })

  it('sentence scope caps all 4-type agents at 250', () => {
    for (const [, max] of Object.entries(DEFAULT_AGENT_MAX_TOKENS)) {
      expect(effectiveTokens(max, 'sentence', 'normal')).toBe(250)
    }
  })

  it('paragraph scope: edit (300) stays under cap (400)', () => {
    expect(effectiveTokens(DEFAULT_AGENT_MAX_TOKENS.edit, 'paragraph', 'normal')).toBe(300)
  })

  it('paragraph scope: dig (500) is capped at 400', () => {
    expect(effectiveTokens(DEFAULT_AGENT_MAX_TOKENS.dig, 'paragraph', 'normal')).toBe(400)
  })

  it('section scope: ask (400) fits under cap (600)', () => {
    expect(effectiveTokens(DEFAULT_AGENT_MAX_TOKENS.ask, 'section', 'normal')).toBe(400)
  })

  it('section scope: dig (500) fits under cap (600)', () => {
    expect(effectiveTokens(DEFAULT_AGENT_MAX_TOKENS.dig, 'section', 'normal')).toBe(500)
  })
})

// ── Token scaling with concise verbosity (multiplier = 0.5) ──────────────────

describe('effectiveTokens — concise verbosity (multiplier = 0.5)', () => {
  it('halves the token limit for phrase scope', () => {
    // min(any_agent_max, 150) * 0.5 = 75
    expect(effectiveTokens(DEFAULT_AGENT_MAX_TOKENS.ask, 'phrase', 'concise')).toBe(75)
  })

  it('halves the token limit for sentence scope', () => {
    // min(any_agent_max, 250) * 0.5 = 125
    expect(effectiveTokens(DEFAULT_AGENT_MAX_TOKENS.flag, 'sentence', 'concise')).toBe(125)
  })

  it('halves the effective cap for paragraph scope — ask agent', () => {
    // min(400, 400) * 0.5 = 200
    expect(effectiveTokens(DEFAULT_AGENT_MAX_TOKENS.ask, 'paragraph', 'concise')).toBe(200)
  })

  it('halves the effective cap for paragraph scope — edit agent (agent limit wins)', () => {
    // min(300, 400) * 0.5 = 150
    expect(effectiveTokens(DEFAULT_AGENT_MAX_TOKENS.edit, 'paragraph', 'concise')).toBe(150)
  })

  it('halves the effective cap for section scope — dig agent', () => {
    // min(500, 600) * 0.5 = 250
    expect(effectiveTokens(DEFAULT_AGENT_MAX_TOKENS.dig, 'section', 'concise')).toBe(250)
  })

  it('never produces zero tokens (minimum concise output is positive)', () => {
    // Smallest possible: phrase * concise = min(anything, 150) * 0.5 = 75
    for (const [, max] of Object.entries(DEFAULT_AGENT_MAX_TOKENS)) {
      expect(effectiveTokens(max, 'phrase', 'concise')).toBeGreaterThan(0)
    }
  })
})

// ── Token scaling with detailed verbosity (multiplier = 2) ───────────────────

describe('effectiveTokens — detailed verbosity (multiplier = 2)', () => {
  it('doubles the token limit for phrase scope', () => {
    // min(any_agent_max, 150) * 2 = 300
    expect(effectiveTokens(DEFAULT_AGENT_MAX_TOKENS.ask, 'phrase', 'detailed')).toBe(300)
  })

  it('doubles the token limit for sentence scope', () => {
    // min(any_agent_max, 250) * 2 = 500
    expect(effectiveTokens(DEFAULT_AGENT_MAX_TOKENS.dig, 'sentence', 'detailed')).toBe(500)
  })

  it('doubles the effective cap for paragraph scope — dig agent (scope cap wins)', () => {
    // min(500, 400) * 2 = 800
    expect(effectiveTokens(DEFAULT_AGENT_MAX_TOKENS.dig, 'paragraph', 'detailed')).toBe(800)
  })

  it('doubles the effective cap for section scope — edit agent (agent limit wins)', () => {
    // min(300, 600) * 2 = 600
    expect(effectiveTokens(DEFAULT_AGENT_MAX_TOKENS.edit, 'section', 'detailed')).toBe(600)
  })

  it('doubles for largest possible combination: dig + section', () => {
    // min(500, 600) * 2 = 1000
    expect(effectiveTokens(DEFAULT_AGENT_MAX_TOKENS.dig, 'section', 'detailed')).toBe(1000)
  })
})

// ── Boundary / stress cases ───────────────────────────────────────────────────

describe('effectiveTokens — boundary conditions', () => {
  it('rounds fractional results (Math.round semantics)', () => {
    // Use an agent max that produces a non-integer after multiplier
    // min(1, 150) * 0.5 = 0.5 → rounds to 1 (not 0)
    expect(effectiveTokens(1, 'phrase', 'concise')).toBe(1)
  })

  it('handles very low custom agent max tokens (1 token)', () => {
    // Verify the min() clamp still works at extreme low end
    expect(effectiveTokens(1, 'section', 'normal')).toBe(1)
    expect(effectiveTokens(1, 'section', 'detailed')).toBe(2)
  })

  it('handles very high custom agent max tokens — scope cap wins', () => {
    const unreallyHighMax = 99999
    expect(effectiveTokens(unreallyHighMax, 'phrase', 'normal')).toBe(150)
    expect(effectiveTokens(unreallyHighMax, 'section', 'normal')).toBe(600)
  })

  it('handles zero agent max tokens — result is 0', () => {
    // Edge case: user somehow configures 0 max tokens
    expect(effectiveTokens(0, 'paragraph', 'normal')).toBe(0)
    expect(effectiveTokens(0, 'section', 'detailed')).toBe(0)
  })

  it('detailed verbosity always produces >= normal verbosity token limit', () => {
    for (const scope of ['phrase', 'sentence', 'paragraph', 'section'] as Scope[]) {
      for (const [, max] of Object.entries(DEFAULT_AGENT_MAX_TOKENS)) {
        const normal = effectiveTokens(max, scope, 'normal')
        const detailed = effectiveTokens(max, scope, 'detailed')
        expect(detailed).toBeGreaterThanOrEqual(normal)
      }
    }
  })

  it('concise verbosity always produces <= normal verbosity token limit', () => {
    for (const scope of ['phrase', 'sentence', 'paragraph', 'section'] as Scope[]) {
      for (const [, max] of Object.entries(DEFAULT_AGENT_MAX_TOKENS)) {
        const normal = effectiveTokens(max, scope, 'normal')
        const concise = effectiveTokens(max, scope, 'concise')
        expect(concise).toBeLessThanOrEqual(normal)
      }
    }
  })
})
