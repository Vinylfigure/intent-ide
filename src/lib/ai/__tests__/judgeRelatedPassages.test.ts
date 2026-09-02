import { describe, it, expect } from 'vitest'
import type { LLMConfig } from '@/stores/settingsStore'
import type { CallStructuredFn, StructuredRequest } from '@/lib/ai/structuredClient'
import type { RelatedPassage } from '@/lib/ai/intentContext'
import { judgeRelatedPassages, type JudgeSeed } from '@/lib/ai/judgeRelatedPassages'

const CONFIG: LLMConfig = { provider: 'claude', apiKey: 'test-key', model: 'test-model' }

const SEED: JudgeSeed = { text: 'The vendor agreement caps liability at $50,000.', headingPath: ['Contracts'] }

function passage(overrides: Partial<RelatedPassage> = {}): RelatedPassage {
  return {
    blockId: 'b1',
    text: 'Elsewhere the same vendor is mentioned in the appendix.',
    headingPath: ['Appendix'],
    hop: 1,
    why: 'shares term "vendor"',
    whyPath: 'term-overlap',
    score: 0.4,
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

function verdict(index: number, genuinely_related: boolean, reason = 'because') {
  return { name: 'verdict', input: { index, genuinely_related, reason } }
}

describe('judgeRelatedPassages — batching and prompt shape', () => {
  it('makes exactly ONE structured call listing every candidate in the prescribed format', async () => {
    const captured: StructuredRequest[] = []
    await judgeRelatedPassages(
      SEED,
      [passage(), passage({ blockId: 'b2', text: 'A different clause about payment terms.' })],
      CONFIG,
      scripted([verdict(1, true), verdict(2, false)], captured),
    )
    expect(captured).toHaveLength(1)
    const user = captured[0].messages.find((m) => m.role === 'user')!.content
    expect(user).toContain('SEED [Contracts]: "The vendor agreement caps liability at $50,000."')
    expect(user).toContain(
      '[1] CANDIDATE [Appendix]: "Elsewhere the same vendor is mentioned in the appendix."',
    )
    expect(user).toContain('[2] CANDIDATE [Appendix]: "A different clause about payment terms."')
    expect(captured[0].tools.map((t) => t.name)).toEqual(['verdict'])
  })

  it("includes both the seed and every candidate's text in the prompt", async () => {
    const captured: StructuredRequest[] = []
    await judgeRelatedPassages(
      SEED,
      [passage({ text: 'UNIQUE CANDIDATE TEXT MARKER' })],
      CONFIG,
      scripted([verdict(1, true)], captured),
    )
    const user = captured[0].messages.find((m) => m.role === 'user')!.content
    expect(user).toContain(SEED.text)
    expect(user).toContain('UNIQUE CANDIDATE TEXT MARKER')
  })

  it('scales maxTokens with candidate count and caps at 8000', async () => {
    const captured: StructuredRequest[] = []
    await judgeRelatedPassages(
      SEED,
      [passage(), passage({ blockId: 'b2' }), passage({ blockId: 'b3' })],
      CONFIG,
      scripted([verdict(1, true)], captured),
    )
    expect(captured[0].maxTokens).toBe(400 + 200 * 3)

    const many = Array.from({ length: 50 }, (_, i) => passage({ blockId: `m${i}` }))
    await judgeRelatedPassages(SEED, many, CONFIG, scripted([verdict(1, true)], captured))
    expect(captured[1].maxTokens).toBe(8000)
  })

  it('routes the verdict call to the utility model (Haiku on Claude, unchanged elsewhere)', async () => {
    const seen: string[] = []
    const capturingCall: CallStructuredFn = async (_req, config) => {
      seen.push(config.model)
      return { toolCalls: [verdict(1, true)] }
    }
    await judgeRelatedPassages(
      SEED,
      [passage()],
      { provider: 'claude', apiKey: 'k', model: 'claude-fable-5' },
      capturingCall,
    )
    await judgeRelatedPassages(
      SEED,
      [passage()],
      { provider: 'ollama', apiKey: '', model: 'llama3.2' },
      capturingCall,
    )
    expect(seen).toEqual(['claude-haiku-4-5', 'llama3.2'])
  })

  it('returns an empty map without calling the model when there are no candidates', async () => {
    let called = false
    const verdicts = await judgeRelatedPassages(SEED, [], CONFIG, async () => {
      called = true
      return { toolCalls: [] }
    })
    expect(verdicts.size).toBe(0)
    expect(called).toBe(false)
  })
})

describe('judgeRelatedPassages — verdict parsing', () => {
  it('maps 1-based prompt indices back to 0-based candidate indices', async () => {
    const verdicts = await judgeRelatedPassages(
      SEED,
      [passage(), passage({ blockId: 'b2' })],
      CONFIG,
      scripted([verdict(1, true, 'genuinely bears'), verdict(2, false, 'coincidental overlap')]),
    )
    expect(verdicts.get(0)).toEqual({ related: true, reason: 'genuinely bears' })
    expect(verdicts.get(1)).toEqual({ related: false, reason: 'coincidental overlap' })
  })

  it('a PARTIALLY missing verdict defaults the skipped index to NOT related (skeptical default), never a rejection read from silence alone', async () => {
    const verdicts = await judgeRelatedPassages(
      SEED,
      [passage(), passage({ blockId: 'b2' })],
      CONFIG,
      scripted([verdict(2, true)]), // model skipped candidate 1
    )
    expect(verdicts.get(0)).toEqual({ related: false, reason: 'no verdict returned' })
    expect(verdicts.get(1)?.related).toBe(true)
  })

  it('ZERO verdicts on a successful call throws (protocol malfunction, not an all-deny)', async () => {
    await expect(
      judgeRelatedPassages(SEED, [passage(), passage({ blockId: 'b2' })], CONFIG, scripted([])),
    ).rejects.toThrow('zero valid verdicts')
  })

  it('all-garbage tool calls count as zero verdicts and throw', async () => {
    await expect(
      judgeRelatedPassages(
        SEED,
        [passage()],
        CONFIG,
        scripted([
          verdict(0, true), // below range
          verdict(7, true), // above range
          { name: 'verdict', input: { index: 'one', genuinely_related: true, reason: 'x' } },
          { name: 'propose_edit', input: { index: 1, genuinely_related: true } },
        ]),
      ),
    ).rejects.toThrow('zero valid verdicts')
  })

  it('ignores out-of-range, non-numeric, and non-verdict tool calls around a valid one', async () => {
    const verdicts = await judgeRelatedPassages(
      SEED,
      [passage(), passage({ blockId: 'b2' })],
      CONFIG,
      scripted([
        verdict(0, true),
        verdict(7, true),
        { name: 'verdict', input: { index: 'one', genuinely_related: true, reason: 'x' } },
        { name: 'propose_edit', input: { index: 1, genuinely_related: true } },
        verdict(1, true, 'the only valid verdict'),
      ]),
    )
    expect(verdicts.get(0)).toEqual({ related: true, reason: 'the only valid verdict' })
    expect(verdicts.get(1)).toEqual({ related: false, reason: 'no verdict returned' })
  })

  it('duplicate indexes: first write wins, but a deny always sticks', async () => {
    const denyFirst = await judgeRelatedPassages(
      SEED,
      [passage()],
      CONFIG,
      scripted([verdict(1, false, 'denied'), verdict(1, true, 'laundered confirm')]),
    )
    expect(denyFirst.get(0)).toEqual({ related: false, reason: 'denied' })

    const denyLater = await judgeRelatedPassages(
      SEED,
      [passage()],
      CONFIG,
      scripted([verdict(1, true, 'early confirm'), verdict(1, false, 'second thoughts')]),
    )
    expect(denyLater.get(0)).toEqual({ related: false, reason: 'second thoughts' })

    const confirmTwice = await judgeRelatedPassages(
      SEED,
      [passage()],
      CONFIG,
      scripted([verdict(1, true, 'first'), verdict(1, true, 'second')]),
    )
    expect(confirmTwice.get(0)).toEqual({ related: true, reason: 'first' })
  })

  it('treats a non-boolean genuinely_related as a denial and fills blank reasons', async () => {
    const verdicts = await judgeRelatedPassages(
      SEED,
      [passage()],
      CONFIG,
      scripted([{ name: 'verdict', input: { index: 1, genuinely_related: 'yes', reason: '' } }]),
    )
    expect(verdicts.get(0)).toEqual({ related: false, reason: 'no reason given' })
  })

  it('propagates a structured-call failure to the caller (who keeps the heuristic result)', async () => {
    await expect(
      judgeRelatedPassages(SEED, [passage()], CONFIG, async () => {
        throw new Error('provider down')
      }),
    ).rejects.toThrow('provider down')
  })

  it("the structured request carries every candidate, in order", async () => {
    const captured: StructuredRequest[] = []
    const many = Array.from({ length: 5 }, (_, i) =>
      passage({ blockId: `m${i}`, text: `candidate text ${i}` }),
    )
    await judgeRelatedPassages(
      SEED,
      many,
      CONFIG,
      scripted(many.map((_, i) => verdict(i + 1, true)), captured),
    )
    const user = captured[0].messages.find((m) => m.role === 'user')!.content
    many.forEach((p, i) => {
      expect(user).toContain(`[${i + 1}] CANDIDATE`)
      expect(user).toContain(p.text)
    })
  })
})
