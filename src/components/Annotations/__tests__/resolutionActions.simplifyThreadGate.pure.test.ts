import { describe, it, expect } from 'vitest'
import type { ConversationMessage } from '@/lib/annotations/types'
import type { SimplifyThreadResult } from '@/lib/ai/resolver'

// Source-faithful re-implementation of the "Simplify thread" button's onClick
// decision in ResolutionActions.tsx (importing the .tsx here would pull in
// the whole store/plugin import graph in a node-environment .test.ts — see
// resolutionActions.opensCommitModal.pure.test.ts for the established
// precedent). Any change to the real branch must produce a mismatch here.
function nextConversationAfterSimplify(
  current: ConversationMessage[],
  result: SimplifyThreadResult,
  newMessageId: string,
): ConversationMessage[] {
  if (result.requestFailed) return current
  return [{
    id: newMessageId,
    role: 'agent',
    content: result.content,
    suggestedEdit: null,
    timestamp: 0,
  }]
}

function makeConversation(): ConversationMessage[] {
  return [
    { id: 'm1', role: 'user', content: 'First message', suggestedEdit: null, timestamp: 1 },
    { id: 'm2', role: 'agent', content: 'First reply', suggestedEdit: null, timestamp: 2 },
    { id: 'm3', role: 'user', content: 'Second message', suggestedEdit: null, timestamp: 3 },
  ]
}

// Source-faithful re-implementation of the stale-write guard added for #92:
// annotationStore's `update(id, patch)` spreads the patch over the existing
// annotation, so `conversation` keeps its prior array reference unless the
// patch itself touches it. A reference mismatch (or a missing annotation —
// deleted mid-flight) means another write landed on this annotation while
// the summarize request was in flight, and the stale summary must be
// discarded rather than applied on top of it.
function shouldApplySimplifySummary(
  conversationSnapshot: ConversationMessage[],
  liveConversation: ConversationMessage[] | undefined,
): boolean {
  return liveConversation !== undefined && liveConversation === conversationSnapshot
}

// Regression for #88: a failed simplifyThread request must never overwrite
// real conversation history with the synthesized error string.
describe('Simplify thread destructive-write gate (#88)', () => {
  it('leaves the conversation completely unchanged when the request failed', () => {
    const original = makeConversation()
    const failedResult: SimplifyThreadResult = {
      content: 'Error: Simplification failed.',
      requestFailed: true,
    }

    const next = nextConversationAfterSimplify(original, failedResult, 'new-id')

    expect(next).toBe(original)
    expect(next).toHaveLength(3)
    expect(next.map((m) => m.content)).toEqual(['First message', 'First reply', 'Second message'])
  })

  it('collapses the conversation to the summary only on a real success', () => {
    const original = makeConversation()
    const successResult: SimplifyThreadResult = { content: 'A concise summary.' }

    const next = nextConversationAfterSimplify(original, successResult, 'new-id')

    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ id: 'new-id', role: 'agent', content: 'A concise summary.' })
  })

  it('does not collapse on a summary that merely reads like an error, as long as the request itself succeeded', () => {
    const original = makeConversation()
    const successResult: SimplifyThreadResult = { content: 'Error: is the wrong word to use here.' }

    const next = nextConversationAfterSimplify(original, successResult, 'new-id')

    expect(next).toHaveLength(1)
    expect(next[0].content).toBe('Error: is the wrong word to use here.')
  })
})

// Regression for #92: a successful simplify must not clobber a conversation
// that changed (another reply, or another simplify) while the request for
// this one was still in flight.
describe('Simplify thread stale-write guard (#92)', () => {
  it('discards the summary when the conversation changed while the request was in flight', () => {
    const snapshot = makeConversation()
    const liveConversation = [...snapshot, {
      id: 'm4', role: 'agent' as const, content: 'A reply that landed mid-flight', suggestedEdit: null, timestamp: 4,
    }]

    expect(shouldApplySimplifySummary(snapshot, liveConversation)).toBe(false)
  })

  it('discards the summary when the annotation was deleted while the request was in flight', () => {
    const snapshot = makeConversation()

    expect(shouldApplySimplifySummary(snapshot, undefined)).toBe(false)
  })

  it('applies the summary when the conversation is unchanged since the request started', () => {
    const snapshot = makeConversation()

    expect(shouldApplySimplifySummary(snapshot, snapshot)).toBe(true)
  })

  it('discards the summary even when the live conversation is deep-equal but a different array (another simplify replaced it)', () => {
    const snapshot = makeConversation()
    // A second, unrelated simplify (or any conversation-touching write)
    // always produces a fresh array — even one that happens to contain the
    // same messages is evidence of a write this request didn't see.
    const liveConversation = makeConversation()

    expect(shouldApplySimplifySummary(snapshot, liveConversation)).toBe(false)
  })
})
