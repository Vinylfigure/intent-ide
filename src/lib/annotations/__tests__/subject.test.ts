import { describe, it, expect } from 'vitest'
import { annotationSubject } from '../subject'
import type { Annotation } from '../types'

// The reported failure, reproduced from the panel: a four-deep thread rooted on
// the document heading "What is tokenization?". Each child was created with the
// "Spin off annotation" button, which passes no `quote` and inherits the
// parent's document position. At depth 3 the reader asked "is the token in this
// context a hash value?" and the resolver was told the subject was still the
// root's heading -- so the answer opened with
//   This document does not define "What is tokenization?"
//
// The anchor inheritance is correct and deliberate (there is no document
// position for text that only exists inside an answer). The SUBJECT inheritance
// was not.

function ann(over: Partial<Annotation>): Annotation {
  return {
    id: 'a1',
    documentId: 'doc',
    locationGroupKey: 'doc:10:31',
    type: 'ask',
    status: 'resolved',
    transcript: '',
    anchor: { from: 10, to: 31, scope: 'sentence', text: 'What is tokenization?' },
    resolution: null,
    conversation: [],
    parentId: null,
    childIds: [],
    createdAt: 0,
    resolvedAt: null,
    verbosity: 'normal',
    ...over,
  }
}

describe('annotationSubject', () => {
  it('uses the document selection for a root annotation', () => {
    const a = ann({ parentId: null, transcript: 'what is tokenization in this context?' })
    expect(annotationSubject(a)).toBe('What is tokenization?')
  })

  it('uses the highlighted span when the child was drilled out of an answer', () => {
    const a = ann({
      parentId: 'root',
      transcript: 'explain this in plain language',
      sourceQuote: 'Workload Identity Federation',
    })
    expect(annotationSubject(a)).toBe('Workload Identity Federation')
  })

  it("uses a child's own question when it has no quote, never the inherited anchor", () => {
    // The regression. Before the fix this returned "What is tokenization?".
    const a = ann({
      parentId: 'depth2',
      transcript: 'is the token in this context a hash value?',
    })
    expect(annotationSubject(a)).toBe('is the token in this context a hash value?')
    expect(annotationSubject(a)).not.toBe('What is tokenization?')
  })

  it('does not let the root anchor leak down an arbitrarily deep chain', () => {
    const chain = ['Give one concrete example that illustrates this passage.',
      'is the token in this context a hash value?',
      'Would tokenization here be a hash value?']
    for (const transcript of chain) {
      expect(annotationSubject(ann({ parentId: 'parent', transcript }))).toBe(transcript)
    }
  })

  it('prefers the quote over the transcript when both are present', () => {
    const a = ann({ parentId: 'root', transcript: 'say more', sourceQuote: 'Bucket Lock' })
    expect(annotationSubject(a)).toBe('Bucket Lock')
  })

  it('trims a quote and ignores a whitespace-only one', () => {
    expect(annotationSubject(ann({ parentId: 'r', transcript: 'q', sourceQuote: '  WIF  ' }))).toBe('WIF')
    expect(annotationSubject(ann({ parentId: 'r', transcript: 'q', sourceQuote: '   ' }))).toBe('q')
  })

  it('falls back to the anchor when a child has nothing else to offer', () => {
    // A voice capture that transcribed to nothing. The old behaviour, kept
    // deliberately as the least-wrong option when there is no question to read.
    const a = ann({ parentId: 'root', transcript: '   ' })
    expect(annotationSubject(a)).toBe('What is tokenization?')
  })
})
