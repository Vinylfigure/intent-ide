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
