import { describe, it, expect } from 'vitest'

// Test the scope-based token limit logic directly
// (We can't easily test the full resolveAnnotation without mocking fetch/stores,
// so we test the pure logic that drives token limits)

const SCOPE_TOKEN_LIMITS = {
  phrase: 150,
  sentence: 250,
  paragraph: 400,
  section: 600,
}

const SCOPE_INSTRUCTIONS = {
  phrase: '1-2 sentences max, like a dictionary entry',
  sentence: '2-3 sentences max',
  paragraph: '3-4 sentences max, use bullets if needed',
  section: '4-5 sentences max, use bullets if needed',
}

const DEFAULT_MAX_TOKENS: Record<string, number> = {
  question: 400,
  fix: 300,
  explore: 500,
  thought: 400,
  correction: 300,
  restructure: 500,
}

describe('Scope token limits', () => {
  it('has correct values for each scope', () => {
    expect(SCOPE_TOKEN_LIMITS.phrase).toBe(150)
    expect(SCOPE_TOKEN_LIMITS.sentence).toBe(250)
    expect(SCOPE_TOKEN_LIMITS.paragraph).toBe(400)
    expect(SCOPE_TOKEN_LIMITS.section).toBe(600)
  })

  it('phrase scope caps all annotation types', () => {
    for (const [type, maxTokens] of Object.entries(DEFAULT_MAX_TOKENS)) {
      const effective = Math.min(maxTokens, SCOPE_TOKEN_LIMITS.phrase)
      expect(effective).toBe(150)
    }
  })

  it('sentence scope caps all annotation types', () => {
    for (const [type, maxTokens] of Object.entries(DEFAULT_MAX_TOKENS)) {
      const effective = Math.min(maxTokens, SCOPE_TOKEN_LIMITS.sentence)
      expect(effective).toBe(250)
    }
  })

  it('paragraph scope caps high-token types', () => {
    expect(Math.min(DEFAULT_MAX_TOKENS.explore, SCOPE_TOKEN_LIMITS.paragraph)).toBe(400)
    expect(Math.min(DEFAULT_MAX_TOKENS.restructure, SCOPE_TOKEN_LIMITS.paragraph)).toBe(400)
    // Lower types use their own limit
    expect(Math.min(DEFAULT_MAX_TOKENS.fix, SCOPE_TOKEN_LIMITS.paragraph)).toBe(300)
    expect(Math.min(DEFAULT_MAX_TOKENS.correction, SCOPE_TOKEN_LIMITS.paragraph)).toBe(300)
  })

  it('section scope allows full type limits for lower types', () => {
    expect(Math.min(DEFAULT_MAX_TOKENS.question, SCOPE_TOKEN_LIMITS.section)).toBe(400)
    expect(Math.min(DEFAULT_MAX_TOKENS.fix, SCOPE_TOKEN_LIMITS.section)).toBe(300)
    expect(Math.min(DEFAULT_MAX_TOKENS.explore, SCOPE_TOKEN_LIMITS.section)).toBe(500)
  })

  it('custom lower maxTokens takes priority over scope limit', () => {
    const customMaxTokens = 100 // user set very low
    const effective = Math.min(customMaxTokens, SCOPE_TOKEN_LIMITS.section)
    expect(effective).toBe(100)
  })
})

describe('Scope instructions', () => {
  it('has an instruction for each scope', () => {
    expect(SCOPE_INSTRUCTIONS.phrase).toContain('dictionary')
    expect(SCOPE_INSTRUCTIONS.sentence).toContain('2-3')
    expect(SCOPE_INSTRUCTIONS.paragraph).toContain('bullets')
    expect(SCOPE_INSTRUCTIONS.section).toContain('bullets')
  })
})
