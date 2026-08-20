import { describe, expect, it, vi } from 'vitest'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'
import type { LLMConfig } from '@/stores/settingsStore'
import type { DocGraph } from '@/lib/graphrag/docGraph'
import {
  checkEntailmentInvariants,
  judgeEntailmentPairs,
  selectCandidates,
  type EntailmentPair,
  type EntailmentVerdict,
} from '../entailmentCheck'
import type { Invariant } from '../captureInvariant'

function p(blockId: string, text: string): PMNode {
  return schema.node('paragraph', { blockId }, [schema.text(text)])
}

const DECLARE_TEXT = 'Terminations are now thirty days per the updated policy.'
const CONFLICT_TEXT = 'Under the new policy, terminations occur within one and a half months.'

const DOC = schema.node('doc', null, [p('b-declare', DECLARE_TEXT), p('b-conflict', CONFLICT_TEXT)])

const CONFIG: LLMConfig = {
  provider: 'claude',
  apiKey: 'k',
  model: 'claude-sonnet-4-6',
  baseUrl: undefined,
}

/** No deterministic edges — proves the term-sharing recall floor does the work. */
const EMPTY_GRAPH: DocGraph = {
  contentHash: 'h',
  builtAt: 0,
  llmApplied: false,
  llmPartial: false,
  embeddingsApplied: false,
  graphitiApplied: false,
  nodes: new Map(),
  edges: [],
  adjacency: new Map(),
} as unknown as DocGraph

function invariantRecord(overrides: Partial<Invariant> = {}): Invariant {
  return {
    id: 'inv-1',
    documentId: 'doc-A',
    statement: 'terminations are now thirty days',
    blockIds: JSON.stringify(['b-declare']),
    checkKind: 'entailment',
    status: 'active',
    provenanceCommitHash: 'hash-1',
    supersedesId: null,
    createdAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  }
}

/** A judge that returns the given verdict for every pair it is handed. */
function judgeReturning(verdict: EntailmentVerdict) {
  return vi.fn(async (pairs: EntailmentPair[]) => {
    const map = new Map<number, EntailmentVerdict>()
    pairs.forEach((_, i) => map.set(i, verdict))
    return map
  })
}

describe('checkEntailmentInvariants', () => {
  it('flags a passage the judge says contradicts a word-form declared fact', async () => {
    const judge = judgeReturning({ contradicts: true, reason: 'One and a half months is not thirty days.' })

    const violations = await checkEntailmentInvariants(DOC, [invariantRecord()], CONFIG, {
      judge,
      graph: EMPTY_GRAPH,
    })

    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      checkKind: 'entailment',
      invariantId: 'inv-1',
      statement: 'terminations are now thirty days',
      evidenceBlockIds: ['b-declare'],
      conflictBlockId: 'b-conflict',
      conflictText: CONFLICT_TEXT,
      judgeReason: 'One and a half months is not thirty days.',
    })
    // No figure fields on this lane — the discriminated union keeps them off.
    expect(violations[0]).not.toHaveProperty('statementNumber')
  })

  it('produces no flag when the judge says the passage is consistent', async () => {
    const judge = judgeReturning({ contradicts: false, reason: 'Same period, different wording.' })

    const violations = await checkEntailmentInvariants(DOC, [invariantRecord()], CONFIG, {
      judge,
      graph: EMPTY_GRAPH,
    })

    expect(violations).toEqual([])
  })

  it('produces no flag when the judge throws — a broken judge never fabricates a positive', async () => {
    const judge = vi.fn(async () => {
      throw new Error('provider down')
    })

    const violations = await checkEntailmentInvariants(DOC, [invariantRecord()], CONFIG, {
      judge,
      graph: EMPTY_GRAPH,
    })

    expect(violations).toEqual([])
  })

  it('produces no flag when the judge returns verdicts for no candidate', async () => {
    const judge = vi.fn(async () => new Map<number, EntailmentVerdict>())

    const violations = await checkEntailmentInvariants(DOC, [invariantRecord()], CONFIG, {
      judge,
      graph: EMPTY_GRAPH,
    })

    expect(violations).toEqual([])
  })

  it('never calls the judge for deterministic-kind or inactive rows', async () => {
    const judge = judgeReturning({ contradicts: true, reason: 'should not be reached' })

    const violations = await checkEntailmentInvariants(
      DOC,
      [
        invariantRecord({ id: 'inv-det', checkKind: 'deterministic' }),
        invariantRecord({ id: 'inv-resolved', status: 'resolved' }),
      ],
      CONFIG,
      { judge, graph: EMPTY_GRAPH },
    )

    expect(violations).toEqual([])
    expect(judge).not.toHaveBeenCalled()
  })

  it('reports at most one violation per invariant even when several passages contradict', async () => {
    const doc = schema.node('doc', null, [
      p('b-declare', DECLARE_TEXT),
      p('b-conflict-1', CONFLICT_TEXT),
      p('b-conflict-2', 'Terminations elsewhere are handled in under a week.'),
    ])
    const judge = judgeReturning({ contradicts: true, reason: 'conflicts' })

    const violations = await checkEntailmentInvariants(doc, [invariantRecord()], CONFIG, {
      judge,
      graph: EMPTY_GRAPH,
    })

    expect(violations).toHaveLength(1)
  })
})

describe('selectCandidates', () => {
  it('never offers an evidence block as a candidate against its own fact', () => {
    const pairs = selectCandidates(DOC, invariantRecord(), EMPTY_GRAPH)
    expect(pairs.map((c) => c.blockId)).toEqual(['b-conflict'])
  })

  it('skips blocks that neither share a term nor sit in the graph neighborhood', () => {
    const doc = schema.node('doc', null, [
      p('b-declare', DECLARE_TEXT),
      p('b-unrelated', 'Office parking permits are issued each January.'),
    ])
    expect(selectCandidates(doc, invariantRecord(), EMPTY_GRAPH)).toEqual([])
  })

  it('caps candidates per invariant rather than scanning the whole document', () => {
    const blocks = [p('b-declare', DECLARE_TEXT)]
    for (let i = 0; i < 20; i++) {
      blocks.push(p(`b-${i}`, `Section ${i} also describes terminations in some detail.`))
    }
    const pairs = selectCandidates(schema.node('doc', null, blocks), invariantRecord(), EMPTY_GRAPH)
    expect(pairs.length).toBeLessThanOrEqual(6)
  })
})

describe('judgeEntailmentPairs', () => {
  const PAIRS: EntailmentPair[] = [
    {
      invariantId: 'inv-1',
      statement: 'terminations are now thirty days',
      evidenceBlockIds: ['b-declare'],
      blockId: 'b-conflict',
      blockText: CONFLICT_TEXT,
    },
    {
      invariantId: 'inv-1',
      statement: 'terminations are now thirty days',
      evidenceBlockIds: ['b-declare'],
      blockId: 'b-other',
      blockText: 'Terminations follow the schedule above.',
    },
  ]

  it('routes the call to the cheap utility model, never the user-selected one', async () => {
    const call = vi.fn(async (_req: unknown, config: unknown) => {
      void _req
      void config
      return {
        toolCalls: [
          { name: 'entailment_verdict', input: { index: 1, contradicts: true, reason: 'r' } },
        ],
      }
    })

    await judgeEntailmentPairs(PAIRS, CONFIG, call as never)

    expect(call.mock.calls[0][1]).toMatchObject({ model: 'claude-haiku-4-5' })
  })

  it('defaults every candidate the judge skipped to not-contradicting', async () => {
    const call = vi.fn(async () => ({
      toolCalls: [{ name: 'entailment_verdict', input: { index: 1, contradicts: true, reason: 'r' } }],
    }))

    const verdicts = await judgeEntailmentPairs(PAIRS, CONFIG, call as never)

    expect(verdicts.get(0)?.contradicts).toBe(true)
    expect(verdicts.get(1)?.contradicts).toBe(false)
  })

  it('lets the safe answer win when the judge returns two verdicts for one index', async () => {
    const call = vi.fn(async () => ({
      toolCalls: [
        { name: 'entailment_verdict', input: { index: 1, contradicts: true, reason: 'yes' } },
        { name: 'entailment_verdict', input: { index: 1, contradicts: false, reason: 'no' } },
      ],
    }))

    const verdicts = await judgeEntailmentPairs(PAIRS, CONFIG, call as never)

    expect(verdicts.get(0)?.contradicts).toBe(false)
  })

  it('throws on a transport-successful call that yields zero valid verdicts', async () => {
    const call = vi.fn(async () => ({ toolCalls: [{ name: 'something_else', input: {} }] }))

    await expect(judgeEntailmentPairs(PAIRS, CONFIG, call as never)).rejects.toThrow(
      /zero valid verdicts/,
    )
  })

  it('ignores an out-of-range index rather than flagging the wrong candidate', async () => {
    const call = vi.fn(async () => ({
      toolCalls: [
        { name: 'entailment_verdict', input: { index: 99, contradicts: true, reason: 'r' } },
        { name: 'entailment_verdict', input: { index: 2, contradicts: true, reason: 'r' } },
      ],
    }))

    const verdicts = await judgeEntailmentPairs(PAIRS, CONFIG, call as never)

    expect(verdicts.get(0)?.contradicts).toBe(false)
    expect(verdicts.get(1)?.contradicts).toBe(true)
  })
})
