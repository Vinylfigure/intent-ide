import { describe, it, expect, vi } from 'vitest'
import { judgeRenameOccurrences } from '../judgeRenameOccurrences'
import type { LLMConfig } from '@/stores/settingsStore'
import type { StructuredRequest } from '@/lib/ai/structuredClient'

// Whole-word matching finds every "Cody". It cannot tell the Cody who owns the
// runbook from the Cody Framework, and no amount of string matching will.
// Coreference resolution runs at roughly F1 78-81% on curated benchmarks and
// worse on real prose, so the asymmetry is deliberate everywhere here: an
// unclear mention comes back as "needs a human", never as "rename it anyway".

const config = { provider: 'claude', model: 'm', apiKey: 'k' } as unknown as LLMConfig

function verdicts(calls: Array<{ index: number; same_referent: boolean; reason?: string }>) {
  return vi.fn(async (_req: StructuredRequest, _config: LLMConfig) => ({
    toolCalls: calls.map((input) => ({ name: 'verdict', input })),
  }))
}

const occurrences = [
  { sentence: 'Cody owns the runbook.' },
  { sentence: 'The Cody Framework ships with its own linter.' },
]

describe('judgeRenameOccurrences', () => {
  it('separates the same referent from a different thing with the same name', async () => {
    const call = verdicts([
      { index: 1, same_referent: true, reason: 'the person who owns the runbook' },
      { index: 2, same_referent: false, reason: 'a product name, not the person' },
    ])
    const result = await judgeRenameOccurrences({ from: 'Cody', to: 'Joe' }, occurrences, config, call)

    expect(result.get(0)).toMatchObject({ sameReferent: true })
    expect(result.get(1)).toMatchObject({ sameReferent: false })
  })

  it('returns a verdict for every index, defaulting a skipped one to needs-a-human', async () => {
    const call = verdicts([{ index: 1, same_referent: true, reason: 'clear' }])
    const result = await judgeRenameOccurrences({ from: 'Cody', to: 'Joe' }, occurrences, config, call)

    expect(result.size).toBe(2)
    expect(result.get(1)?.sameReferent).toBe(false)
    expect(result.get(1)?.reason).toContain('needs a human')
  })

  it('ignores out-of-range and duplicate indices rather than mis-assigning them', async () => {
    const call = verdicts([
      { index: 99, same_referent: true, reason: 'nonsense index' },
      { index: 1, same_referent: true, reason: 'first' },
      { index: 1, same_referent: false, reason: 'contradicts itself' },
    ])
    const result = await judgeRenameOccurrences({ from: 'Cody', to: 'Joe' }, occurrences, config, call)

    // First verdict for an index wins; the contradicting duplicate is dropped.
    expect(result.get(0)).toMatchObject({ sameReferent: true, reason: 'first' })
    expect(result.get(1)?.sameReferent).toBe(false)
  })

  it('treats a non-boolean same_referent as not confident', async () => {
    const call = vi.fn(async (_req: StructuredRequest, _config: LLMConfig) => ({
      toolCalls: [{ name: 'verdict', input: { index: 1, same_referent: 'yes', reason: 'sloppy' } }],
    }))
    const result = await judgeRenameOccurrences({ from: 'Cody', to: 'Joe' }, occurrences, config, call)
    expect(result.get(0)?.sameReferent).toBe(false)
  })

  it('throws when a transport-successful call yields no usable verdict', async () => {
    // The prompt gives the model no legitimate silent path, so silence is a
    // protocol malfunction. The caller keeps every candidate unjudged rather
    // than letting an empty answer read as a decision.
    const call = vi.fn(async (_req: StructuredRequest, _config: LLMConfig) => ({
      toolCalls: [{ name: 'chatter', input: {} }],
    }))
    await expect(
      judgeRenameOccurrences({ from: 'Cody', to: 'Joe' }, occurrences, config, call),
    ).rejects.toThrow(/no usable verdicts/)
  })

  it('makes no call at all for an empty candidate list', async () => {
    const call = vi.fn(async (_req: StructuredRequest, _config: LLMConfig) => ({
      toolCalls: [] as Array<{ name: string; input: unknown }>,
    }))
    const result = await judgeRenameOccurrences({ from: 'Cody', to: 'Joe' }, [], config, call)
    expect(result.size).toBe(0)
    expect(call).not.toHaveBeenCalled()
  })

  it('puts both names and every numbered sentence in front of the model', async () => {
    const call = verdicts([{ index: 1, same_referent: true }, { index: 2, same_referent: false }])
    await judgeRenameOccurrences({ from: 'Cody', to: 'Joe' }, occurrences, config, call)

    const prompt = call.mock.calls[0][0].messages[1].content as string
    expect(prompt).toContain('"Cody"')
    expect(prompt).toContain('"Joe"')
    expect(prompt).toContain('[1] "Cody owns the runbook."')
    expect(prompt).toContain('[2] "The Cody Framework')
  })

  it('routes to the cheap utility model — verdict checking is utility work', async () => {
    const call = verdicts([{ index: 1, same_referent: true }, { index: 2, same_referent: false }])
    await judgeRenameOccurrences({ from: 'Cody', to: 'Joe' }, occurrences, config, call)
    expect(call.mock.calls[0][1]).toMatchObject({ provider: 'claude' })
  })
})
