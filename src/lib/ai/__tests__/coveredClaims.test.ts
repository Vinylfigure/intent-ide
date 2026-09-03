import { describe, it, expect } from 'vitest'
import {
  answerSimilarity,
  buildCoveredClaims,
  formatCoveredClaims,
  isRepeatOf,
  REPEAT_THRESHOLD,
} from '../coveredClaims'
import type { ConversationMessage } from '@/lib/annotations/types'

// "Go deeper" was clicked twice and returned two near-identical answers. The
// prior conversation WAS being passed as chat history — what was missing was
// any instruction saying what had already been covered. Turn-level repetition
// is a measured failure distinct from decoding-level degeneration, and the
// pattern that works is an explicit coverage constraint rather than hoping the
// model infers novelty from a transcript.

function msg(role: 'user' | 'agent', content: string): ConversationMessage {
  return { id: `${role}-${content.slice(0, 6)}`, role, content, suggestedEdit: null, timestamp: 0 }
}

describe('buildCoveredClaims', () => {
  it('collects the leading sentences of each agent turn', () => {
    const claims = buildCoveredClaims([
      msg('user', 'what is tokenization?'),
      msg('agent', 'Tokenization replaces sensitive data with a token. It reduces scope. Extra detail.'),
    ])
    expect(claims).toEqual([
      'Tokenization replaces sensitive data with a token.',
      'It reduces scope.',
    ])
  })

  it('ignores the reader\'s own turns — the ledger is what the ASSISTANT said', () => {
    const claims = buildCoveredClaims([
      msg('user', 'a question that should not appear in the ledger'),
      msg('agent', 'An answer.'),
    ])
    expect(claims).toEqual(['An answer.'])
  })

  it('keeps the most recent claims when a thread runs long', () => {
    const long = Array.from({ length: 12 }, (_, i) => msg('agent', `Claim number ${i}.`))
    const claims = buildCoveredClaims(long)
    expect(claims.length).toBeLessThanOrEqual(8)
    // A follow-up is most likely to echo what was just said.
    expect(claims[claims.length - 1]).toBe('Claim number 11.')
  })

  it('returns nothing for an empty or user-only conversation', () => {
    expect(buildCoveredClaims([])).toEqual([])
    expect(buildCoveredClaims([msg('user', 'hello')])).toEqual([])
  })

  it('collapses whitespace so a wrapped answer does not produce ragged claims', () => {
    const claims = buildCoveredClaims([msg('agent', 'One\n\n  thing   here.')])
    expect(claims).toEqual(['One thing here.'])
  })
})

describe('formatCoveredClaims', () => {
  it('emits nothing when there is nothing covered', () => {
    expect(formatCoveredClaims([])).toBe('')
  })

  it('states the constraint and gives explicit permission to decline', () => {
    // Models default to producing something rather than admitting there is
    // nothing left; the permission does not guarantee a clean refusal, but
    // without it there is no legitimate path to one at all.
    const out = formatCoveredClaims(['Tokenization replaces sensitive data.'])
    expect(out).toContain('ALREADY SAID IN THIS THREAD')
    expect(out).toContain('Tokenization replaces sensitive data.')
    expect(out).toContain('Add only what is NOT above')
    expect(out).toContain('nothing more to add')
  })
})

describe('answerSimilarity / isRepeatOf', () => {
  it('scores an identical answer as fully overlapping', () => {
    const text = 'Tokenization replaces sensitive card data with a non-sensitive token.'
    expect(answerSimilarity(text, text)).toBe(1)
    expect(isRepeatOf(text, text)).toBe(true)
  })

  it('catches a rephrase that says the same thing', () => {
    // The reported shape: two "Go deeper" clicks, same content, different words.
    const a = 'Model hallucinations are identified through monitoring tool-call audit logs, analyzing prompt and response patterns, and running adversarial tests.'
    const b = 'Model hallucinations are identified by monitoring tool-call audit logs, analyzing prompt and response patterns, and running adversarial tests.'
    expect(isRepeatOf(a, b)).toBe(true)
  })

  it('lets a genuinely different answer through', () => {
    const a = 'Tokenization replaces sensitive card data with a non-sensitive token.'
    const b = 'Audit logs record which downstream systems acted on a given model output, and when.'
    expect(answerSimilarity(a, b)).toBeLessThan(REPEAT_THRESHOLD)
    expect(isRepeatOf(a, b)).toBe(false)
  })

  it('is not fooled by shared filler words alone', () => {
    const a = 'The system is in the process of being reviewed by the team.'
    const b = 'The report is in the hands of the auditor for the quarter.'
    expect(isRepeatOf(a, b)).toBe(false)
  })

  it('handles empty input without dividing by zero', () => {
    expect(answerSimilarity('', 'something')).toBe(0)
    expect(answerSimilarity('', '')).toBe(0)
    expect(isRepeatOf('', '')).toBe(false)
  })
})
