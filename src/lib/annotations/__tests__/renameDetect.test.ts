import { describe, it, expect } from 'vitest'
import {
  detectRename,
  findOccurrences,
  looksLikeProperNoun,
  offerableOccurrences,
  sentenceAround,
  tokenize,
} from '../renameDetect'

// The reported case: the reader changes "Cody" to "Joe" in one place and
// nothing asks whether the other Codys should follow. The hard part is not
// finding the other Codys — it is firing ONLY on a rename, since ordinary
// rewriting is the overwhelming majority of edits and a false-positive
// avalanche would get this switched off in a week.

describe('detectRename', () => {
  it('fires on a single name swapped for another', () => {
    expect(detectRename('Ask Cody about IAM.', 'Ask Joe about IAM.')).toEqual({
      from: 'Cody',
      to: 'Joe',
      replaced: 1,
    })
  })

  it('treats the same swap made twice in one block as ONE rename', () => {
    // This is the case a prefix/suffix character diff gets wrong: the differing
    // region would span both edits plus everything between them, and the edit
    // would be rejected as a rewrite — precisely when the reader has already
    // shown they expect the change to propagate.
    const before = 'Cody owns the runbook. Ask Cody before changing it.'
    const after = 'Joe owns the runbook. Ask Joe before changing it.'
    expect(detectRename(before, after)).toEqual({ from: 'Cody', to: 'Joe', replaced: 2 })
  })

  it('does not fire on ordinary rewriting', () => {
    expect(detectRename('The retention period is 30 days.', 'The retention period is 90 days.')).toBeNull()
    expect(detectRename('This is clear.', 'This is not clear.')).toBeNull()
    expect(
      detectRename('We store the token securely.', 'We store the token in an HSM.'),
    ).toBeNull()
  })

  it('does not fire when two different substitutions happened', () => {
    // Two distinct swaps is a rewrite, whatever the tokens look like.
    expect(detectRename('Cody met Dana.', 'Joe met Sam.')).toBeNull()
  })

  it('does not fire on a lowercase word swap', () => {
    expect(detectRename('the server is warm', 'the server is cold')).toBeNull()
  })

  it('does not fire when the token count changes', () => {
    expect(detectRename('Ask Cody.', 'Ask Joe Smith.')).toBeNull()
    expect(detectRename('Ask Cody.', 'Ask.')).toBeNull()
  })

  it('does not fire on an unchanged block', () => {
    expect(detectRename('Ask Cody.', 'Ask Cody.')).toBeNull()
  })

  it('ignores a pure case change, which is not a rename', () => {
    expect(detectRename('Ask CODY today.', 'Ask Cody today.')).toBeNull()
  })

  it('keeps hyphenated and apostrophised names whole', () => {
    expect(detectRename("Ask O'Neill first.", 'Ask Okafor first.')).toMatchObject({
      from: "O'Neill",
      to: 'Okafor',
    })
    expect(detectRename('Ask Anne-Marie first.', 'Ask Joe first.')).toMatchObject({
      from: 'Anne-Marie',
    })
  })
})

describe('looksLikeProperNoun', () => {
  it('accepts names and rejects ordinary words', () => {
    expect(looksLikeProperNoun('Cody')).toBe(true)
    expect(looksLikeProperNoun('cody')).toBe(false)
    expect(looksLikeProperNoun('X')).toBe(false)
  })

  it('rejects words that merely start a sentence', () => {
    // A capital at the head of a sentence tells you nothing.
    expect(looksLikeProperNoun('The')).toBe(false)
    expect(looksLikeProperNoun('This')).toBe(false)
    expect(looksLikeProperNoun('When')).toBe(false)
  })

  it('rejects a shouted heading word but keeps a short acronym', () => {
    expect(looksLikeProperNoun('IMPLEMENTATION')).toBe(false)
    expect(looksLikeProperNoun('AWS')).toBe(true)
  })
})

describe('findOccurrences', () => {
  const text = [
    'Cody owns the runbook.',
    'Reach him at cody@example.com or see https://cody.example.com/docs.',
    'The reviewer wrote "Cody signed this off" in the margin.',
    'Ask Cody about IAM.',
    'Codyville is a town and must not match.',
  ].join(' ')

  it('finds whole-word occurrences only', () => {
    const found = findOccurrences(text, 'Cody')
    expect(found.every((o) => !text.slice(o.index).startsWith('Codyville'))).toBe(true)
  })

  it('excludes a name inside a quotation as reported speech', () => {
    const quoted = findOccurrences(text, 'Cody').filter((o) => o.excluded === 'quoted')
    expect(quoted).toHaveLength(1)
    expect(quoted[0].sentence).toContain('in the margin')
  })

  it('excludes a name inside an email address or a URL', () => {
    const identifiers = findOccurrences(text, 'cody').filter((o) => o.excluded)
    expect(identifiers.length).toBeGreaterThan(0)
  })

  it('offers only the real narrative references', () => {
    const offerable = offerableOccurrences(text, 'Cody')
    expect(offerable).toHaveLength(2)
    expect(offerable[0].sentence).toContain('owns the runbook')
    expect(offerable[1].sentence).toContain('about IAM')
  })

  it('carries the surrounding sentence, which is what makes a judgement possible', () => {
    // A bare list of positions cannot be reviewed; a sentence can be judged in
    // about two seconds, which is what makes a per-occurrence flow tolerable.
    for (const o of offerableOccurrences(text, 'Cody')) {
      expect(o.sentence.length).toBeGreaterThan(5)
    }
  })

  it('returns nothing for an empty name', () => {
    expect(findOccurrences(text, '')).toEqual([])
  })
})

describe('sentenceAround', () => {
  it('trims to the sentence containing the index', () => {
    const text = 'One thing. Cody owns it. Another thing.'
    expect(sentenceAround(text, text.indexOf('Cody'))).toBe('Cody owns it.')
  })

  it('handles the first and last sentence', () => {
    const text = 'Cody starts here. Then more.'
    expect(sentenceAround(text, 0)).toBe('Cody starts here.')
    const tail = 'Something. Ends with Cody'
    expect(sentenceAround(tail, tail.indexOf('Cody'))).toBe('Ends with Cody')
  })
})

describe('tokenize', () => {
  it('alternates word and non-word runs so a swap stays aligned', () => {
    expect(tokenize('Ask Cody.')).toEqual(['Ask', ' ', 'Cody', '.'])
  })
})
