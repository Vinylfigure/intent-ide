import { describe, it, expect } from 'vitest'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'
import type { LLMConfig } from '@/stores/settingsStore'
import type { CallStructuredFn, StructuredRequest } from '@/lib/ai/structuredClient'
import type { ProposedEdit } from '@/lib/annotations/types'
import { judgeMustCandidates, type JudgePrimary } from '@/lib/ai/relevanceJudge'

const CONFIG: LLMConfig = { provider: 'claude', apiKey: 'test-key', model: 'test-model' }

const PRIMARY: JudgePrimary = { before: '$50,000', newText: '$75,000' }

const DOC: PMNode = schema.node('doc', null, [
  schema.node('paragraph', { blockId: 'b1' }, [schema.text('"Total Budget" means $50,000.')]),
])

function candidate(overrides: Partial<ProposedEdit> = {}): ProposedEdit {
  return {
    id: 'pe_test',
    from: 10,
    to: 20,
    newText: 'new',
    reason: 'stale figure',
    relation: 'cascade',
    status: 'pending',
    targetText: 'Total Budget of $50,000',
    blockId: 'b2',
    severity: 'must',
    evidence: { sourceBlockId: 'b1', quotedText: '$50,000', edgeType: 'contradicts' },
    ...overrides,
  }
}

function scripted(
  calls: Array<{ name: string; input: Record<string, unknown> }>,
  capture?: StructuredRequest[],
): CallStructuredFn {
  return async (req) => {
    capture?.push(req)
    return { toolCalls: calls }
  }
}

function verdict(index: number, genuinely_conflicts: boolean, reason = 'because') {
  return { name: 'verdict', input: { index, genuinely_conflicts, reason } }
}

describe('judgeMustCandidates — batching and prompt shape', () => {
  it('makes exactly ONE structured call listing every candidate in the prescribed format', async () => {
    const captured: StructuredRequest[] = []
    await judgeMustCandidates(
      [candidate(), candidate({ blockId: 'b3', targetText: 'renewal at $50,000' })],
      PRIMARY,
      DOC,
      CONFIG,
      scripted([verdict(1, true), verdict(2, true)], captured),
    )
    expect(captured).toHaveLength(1)
    const user = captured[0].messages.find((m) => m.role === 'user')!.content
    expect(user).toContain('[1] TARGET (block b2): "Total Budget of $50,000"')
    expect(user).toContain('[2] TARGET (block b3): "renewal at $50,000"')
    expect(user).toContain('CITED: "$50,000"')
    expect(user).toContain('PRIMARY was "$50,000" now "$75,000"')
    expect(captured[0].tools.map((t) => t.name)).toEqual(['verdict'])
  })

  it('never leaks a severity field to the model', async () => {
    const captured: StructuredRequest[] = []
    await judgeMustCandidates([candidate()], PRIMARY, DOC, CONFIG, scripted([], captured))
    const everything = captured[0].messages.map((m) => m.content).join('\n')
    expect(everything.toLowerCase()).not.toContain('severity')
    expect(everything.toLowerCase()).not.toContain("'must'")
  })

  it('returns an empty map without calling the model when there are no candidates', async () => {
    let called = false
    const verdicts = await judgeMustCandidates([], PRIMARY, DOC, CONFIG, async () => {
      called = true
      return { toolCalls: [] }
    })
    expect(verdicts.size).toBe(0)
    expect(called).toBe(false)
  })
})

describe('judgeMustCandidates — verdict parsing', () => {
  it('maps 1-based prompt indices back to 0-based candidate indices', async () => {
    const verdicts = await judgeMustCandidates(
      [candidate(), candidate({ blockId: 'b3' })],
      PRIMARY,
      DOC,
      CONFIG,
      scripted([verdict(1, true, 'real conflict'), verdict(2, false, 'coincidental figure')]),
    )
    expect(verdicts.get(0)).toEqual({ genuinelyConflicts: true, reason: 'real conflict' })
    expect(verdicts.get(1)).toEqual({ genuinelyConflicts: false, reason: 'coincidental figure' })
  })

  it('a missing verdict for an index defaults to NOT confirmed (skeptical default)', async () => {
    const verdicts = await judgeMustCandidates(
      [candidate(), candidate({ blockId: 'b3' })],
      PRIMARY,
      DOC,
      CONFIG,
      scripted([verdict(2, true)]), // model skipped candidate 1
    )
    expect(verdicts.get(0)).toEqual({
      genuinelyConflicts: false,
      reason: 'no verdict returned',
    })
    expect(verdicts.get(1)?.genuinelyConflicts).toBe(true)
  })

  it('ignores out-of-range, non-numeric, and non-verdict tool calls', async () => {
    const verdicts = await judgeMustCandidates(
      [candidate()],
      PRIMARY,
      DOC,
      CONFIG,
      scripted([
        verdict(0, true), // below range
        verdict(7, true), // above range
        { name: 'verdict', input: { index: 'one', genuinely_conflicts: true, reason: 'x' } },
        { name: 'propose_edit', input: { index: 1, genuinely_conflicts: true } },
      ]),
    )
    expect(verdicts.get(0)).toEqual({
      genuinelyConflicts: false,
      reason: 'no verdict returned',
    })
  })

  it('treats a non-boolean genuinely_conflicts as a denial and fills blank reasons', async () => {
    const verdicts = await judgeMustCandidates(
      [candidate()],
      PRIMARY,
      DOC,
      CONFIG,
      scripted([{ name: 'verdict', input: { index: 1, genuinely_conflicts: 'yes', reason: '' } }]),
    )
    expect(verdicts.get(0)).toEqual({ genuinelyConflicts: false, reason: 'no reason given' })
  })

  it('propagates a structured-call failure to the caller (who keeps derived severities)', async () => {
    await expect(
      judgeMustCandidates([candidate()], PRIMARY, DOC, CONFIG, async () => {
        throw new Error('provider down')
      }),
    ).rejects.toThrow('provider down')
  })
})
