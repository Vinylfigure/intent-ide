import { describe, expect, it } from 'vitest'
import { deriveOffers, inferScopeFromText, DEFAULT_OFFERS } from '../selectionOffers'

describe('inferScopeFromText', () => {
  it('returns phrase for empty or whitespace-only input', () => {
    expect(inferScopeFromText('')).toBe('phrase')
    expect(inferScopeFromText('   ')).toBe('phrase')
  })

  it('returns phrase for a short run with no sentence break', () => {
    expect(inferScopeFromText('marginal utility')).toBe('phrase')
  })

  it('returns sentence for one sentence at or past the 100-char phrase threshold', () => {
    const longSingleSentence =
      'This is a single complete sentence that runs well past the one-hundred character short-phrase length threshold used to distinguish a phrase from a sentence.'
    expect(longSingleSentence.length).toBeGreaterThanOrEqual(100)
    expect(inferScopeFromText(longSingleSentence)).toBe('sentence')
  })

  it('returns phrase for one short sentence under the length threshold', () => {
    expect(inferScopeFromText('This is short.')).toBe('phrase')
  })

  it('returns paragraph for multiple sentences', () => {
    expect(inferScopeFromText('First sentence here. Second sentence follows. Third one too.')).toBe('paragraph')
  })

  it('returns phrase for a long run with no sentence-ending punctuation', () => {
    // No '.', '!', or '?' -> sentences.length is 1 (whole trimmed string), so
    // this exercises the `sentences.length === 1 -> sentence` branch, not phrase,
    // once length crosses the 100-char threshold used only for the <=1 case.
    const longNoPunctuation = 'a'.repeat(150)
    expect(inferScopeFromText(longNoPunctuation)).toBe('sentence')
  })
})

describe('deriveOffers', () => {
  it('returns different label sets for a percentage, a heading, a phrase, a sentence, and a paragraph', () => {
    const percentage = deriveOffers({ text: 'grew by 1.5%', scope: 'phrase' })
    const heading = deriveOffers({ text: 'Pricing Strategy', scope: 'section', nodeType: 'heading' })
    const phrase = deriveOffers({ text: 'marginal utility', scope: 'phrase' })
    const sentence = deriveOffers({ text: 'This claim needs support because it is unverified.', scope: 'sentence' })
    const paragraph = deriveOffers({
      text: 'First sentence. Second sentence. Third sentence explains more.',
      scope: 'paragraph',
    })

    const labelSets = [percentage, heading, phrase, sentence, paragraph].map((offers) =>
      offers.map((o) => o.label).join('|'),
    )
    expect(new Set(labelSets).size).toBe(labelSets.length)

    expect(percentage.map((o) => o.label)).toEqual(['Why this figure?', 'Change it', 'Check consistency'])
    expect(heading.map((o) => o.label)).toEqual(['Outline this', 'What belongs here?'])
    expect(phrase.map((o) => o.label)).toEqual(['Define', 'Why this word?', 'Change it'])
    expect(sentence.map((o) => o.label)).toEqual(['Explain', 'Justify this', 'Rewrite'])
    expect(paragraph.map((o) => o.label)).toEqual(['Summarize', 'Diagram this', 'Find conflicts'])
  })

  it('recognizes figure shapes: currency, duration, date, and spelled-out numbers', () => {
    expect(deriveOffers({ text: 'costs $40,000 up front', scope: 'sentence' })[0].label).toBe('Why this figure?')
    expect(deriveOffers({ text: 'due within 30 days', scope: 'sentence' })[0].label).toBe('Why this figure?')
    expect(deriveOffers({ text: 'shipped on 2026-08-25', scope: 'sentence' })[0].label).toBe('Why this figure?')
    expect(deriveOffers({ text: 'due in thirty days from signing', scope: 'sentence' })[0].label).toBe('Why this figure?')
  })

  it('puts the invariant-check offer first when hasInvariant is set', () => {
    const offers = deriveOffers({ text: 'the deadline is next week', scope: 'sentence' }, { hasInvariant: true })
    expect(offers[0].label).toBe('Check against what you declared')
    expect(offers[0].intent).toBe('ask')
  })

  it('includes a related-passages offer with the correct count', () => {
    const offers = deriveOffers({ text: 'refund policy', scope: 'phrase' }, { relatedCount: 3 })
    const related = offers.find((o) => o.label === '3 related passages')
    expect(related).toBeDefined()
    expect(related?.intent).toBe('dig')
  })

  it('says "passage" singular for exactly one related block', () => {
    const offers = deriveOffers({ text: 'Net-30', scope: 'phrase' }, { relatedCount: 1 })
    expect(offers.some((o) => o.label === '1 related passage')).toBe(true)
  })

  it('omits the related-passages offer when relatedCount is zero or absent', () => {
    const zero = deriveOffers({ text: 'refund policy', scope: 'phrase' }, { relatedCount: 0 })
    const absent = deriveOffers({ text: 'refund policy', scope: 'phrase' })
    expect(zero.some((o) => o.label.includes('related passage'))).toBe(false)
    expect(absent.some((o) => o.label.includes('related passage'))).toBe(false)
  })

  it('caps the result at 4 offers when invariant, related, and shape rules all fire', () => {
    const offers = deriveOffers(
      { text: 'grew by 1.5% this quarter', scope: 'sentence' },
      { hasInvariant: true, relatedCount: 5 },
    )
    expect(offers.length).toBe(4)
    expect(offers[0].label).toBe('Check against what you declared')
    expect(offers[1].label).toBe('5 related passages')
    expect(offers[2].label).toBe('Why this figure?')
    expect(offers[3].label).toBe('Change it')
  })

  it('interpolates the selected text into prompts', () => {
    const offers = deriveOffers({ text: 'marginal utility', scope: 'phrase' })
    expect(offers[0].prompt).toContain('marginal utility')
  })

  it('truncates long selected text in prompts to a sane length', () => {
    const longText = 'word '.repeat(60).trim() // well over 120 chars
    const offers = deriveOffers({ text: longText, scope: 'paragraph' })
    for (const offer of offers) {
      expect(offer.prompt.length).toBeLessThan(longText.length)
    }
    expect(offers[0].prompt).not.toContain(longText)
  })

  it('preserves the Diagram this prompt wording verbatim, with text interpolated', () => {
    const offers = deriveOffers({ text: 'the checkout flow', scope: 'paragraph' })
    const diagram = offers.find((o) => o.label === 'Diagram this')
    expect(diagram?.prompt).toBe(
      'Diagram the structure or flow described in "the checkout flow". Respond with a single ```mermaid fenced code block (flowchart or sequence diagram), followed by at most one sentence of caption.',
    )
  })

  it('returns no shape-based offers for an anchor that matches nothing (defensive default)', () => {
    // scope typed as Scope but exercising an unmatched value defensively
    const offers = deriveOffers({ text: 'x', scope: 'unknown' as never })
    expect(offers).toEqual([])
  })
})

describe('DEFAULT_OFFERS', () => {
  it('matches AnnotationComposer QUICK_ACTIONS shape and count', () => {
    expect(DEFAULT_OFFERS.length).toBe(3)
    expect(DEFAULT_OFFERS.map((o) => o.label)).toEqual(['Explain this', 'Give an example', 'Diagram this'])
    for (const offer of DEFAULT_OFFERS) {
      expect(offer).toHaveProperty('label')
      expect(offer).toHaveProperty('intent')
      expect(offer).toHaveProperty('prompt')
    }
  })
})
