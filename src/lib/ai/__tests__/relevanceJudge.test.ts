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

  it("includes the target block's live text as CONTEXT when the blockId resolves", async () => {
    const captured: StructuredRequest[] = []
    await judgeMustCandidates(
      [candidate({ blockId: 'b1', targetText: '$50,000' })],
      PRIMARY,
      DOC,
      CONFIG,
      scripted([verdict(1, true)], captured),
    )
    const user = captured[0].messages.find((m) => m.role === 'user')!.content
    // The judge sees the whole surrounding block, not just the target span.
    expect(user).toContain('CONTEXT: ""Total Budget" means $50,000."')
  })

  it('falls back to targetText as CONTEXT when the block no longer resolves', async () => {
    const captured: StructuredRequest[] = []
    await judgeMustCandidates(
      [candidate({ blockId: 'vanished-block' })],
      PRIMARY,
      DOC,
      CONFIG,
      scripted([verdict(1, true)], captured),
    )
    const user = captured[0].messages.find((m) => m.role === 'user')!.content
    expect(user).toContain('CONTEXT: "Total Budget of $50,000"')
  })

  it('scales maxTokens with candidate count and caps at 8000', async () => {
    const captured: StructuredRequest[] = []
    await judgeMustCandidates(
      [candidate(), candidate({ blockId: 'b3' }), candidate({ blockId: 'b4' })],
      PRIMARY,
      DOC,
      CONFIG,
      scripted([verdict(1, true)], captured),
    )
    expect(captured[0].maxTokens).toBe(400 + 200 * 3)

    const many = Array.from({ length: 50 }, (_, i) => candidate({ blockId: `m${i}` }))
    await judgeMustCandidates(many, PRIMARY, DOC, CONFIG, scripted([verdict(1, true)], captured))
    expect(captured[1].maxTokens).toBe(8000)
  })

  it('never leaks a severity field to the model', async () => {
    const captured: StructuredRequest[] = []
    await judgeMustCandidates(
      [candidate()],
      PRIMARY,
      DOC,
      CONFIG,
      scripted([verdict(1, true)], captured),
    )
    const everything = captured[0].messages.map((m) => m.content).join('\n')
    expect(everything.toLowerCase()).not.toContain('severity')
    expect(everything.toLowerCase()).not.toContain("'must'")
  })

  it('routes the verdict call to the utility model (Haiku on Claude, unchanged elsewhere)', async () => {
    const seen: string[] = []
    const capturingCall: CallStructuredFn = async (_req, config) => {
      seen.push(config.model)
      return { toolCalls: [verdict(1, true)] }
    }
    await judgeMustCandidates(
      [candidate()],
      PRIMARY,
      DOC,
      { provider: 'claude', apiKey: 'k', model: 'claude-fable-5' },
      capturingCall,
    )
    await judgeMustCandidates(
      [candidate()],
      PRIMARY,
      DOC,
      { provider: 'ollama', apiKey: '', model: 'llama3.2' },
      capturingCall,
    )
    expect(seen).toEqual(['claude-haiku-4-5', 'llama3.2'])
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

  it('a PARTIALLY missing verdict defaults the skipped index to NOT confirmed (skeptical default)', async () => {
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

  it('ZERO verdicts on a successful call throws (protocol malfunction, not an all-deny)', async () => {
    await expect(
      judgeMustCandidates([candidate(), candidate({ blockId: 'b3' })], PRIMARY, DOC, CONFIG, scripted([])),
    ).rejects.toThrow('zero valid verdicts')
  })

  it('all-garbage tool calls count as zero verdicts and throw', async () => {
    await expect(
      judgeMustCandidates(
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
      ),
    ).rejects.toThrow('zero valid verdicts')
  })

  it('ignores out-of-range, non-numeric, and non-verdict tool calls around a valid one', async () => {
    const verdicts = await judgeMustCandidates(
      [candidate(), candidate({ blockId: 'b3' })],
      PRIMARY,
      DOC,
      CONFIG,
      scripted([
        verdict(0, true), // below range
        verdict(7, true), // above range
        { name: 'verdict', input: { index: 'one', genuinely_conflicts: true, reason: 'x' } },
        { name: 'propose_edit', input: { index: 1, genuinely_conflicts: true } },
        verdict(1, true, 'the only valid verdict'),
      ]),
    )
    expect(verdicts.get(0)).toEqual({ genuinelyConflicts: true, reason: 'the only valid verdict' })
    // The judge engaged, so the individually skipped index gets the skeptical default.
    expect(verdicts.get(1)).toEqual({
      genuinelyConflicts: false,
      reason: 'no verdict returned',
    })
  })

  it('duplicate indexes: first write wins, but a deny always sticks', async () => {
    // deny first → later confirm cannot launder it
    const denyFirst = await judgeMustCandidates(
      [candidate()],
      PRIMARY,
      DOC,
      CONFIG,
      scripted([verdict(1, false, 'denied'), verdict(1, true, 'laundered confirm')]),
    )
    expect(denyFirst.get(0)).toEqual({ genuinelyConflicts: false, reason: 'denied' })

    // confirm first → later deny overrides it
    const denyLater = await judgeMustCandidates(
      [candidate()],
      PRIMARY,
      DOC,
      CONFIG,
      scripted([verdict(1, true, 'early confirm'), verdict(1, false, 'second thoughts')]),
    )
    expect(denyLater.get(0)).toEqual({ genuinelyConflicts: false, reason: 'second thoughts' })

    // confirm twice → first reason wins
    const confirmTwice = await judgeMustCandidates(
      [candidate()],
      PRIMARY,
      DOC,
      CONFIG,
      scripted([verdict(1, true, 'first'), verdict(1, true, 'second')]),
    )
    expect(confirmTwice.get(0)).toEqual({ genuinelyConflicts: true, reason: 'first' })
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
