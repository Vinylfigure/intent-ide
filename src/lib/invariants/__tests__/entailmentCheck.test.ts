import { describe, expect, it, vi } from 'vitest'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'
import type { LLMConfig } from '@/stores/settingsStore'
import type { DocGraph, DocGraphEdge, DocGraphNode } from '@/lib/graphrag/docGraph'
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

function graphOf(edges: DocGraphEdge[]): DocGraph {
  const nodes = new Map<string, DocGraphNode>()
  const adjacency = new Map<string, DocGraphEdge[]>()
  for (const edge of edges) {
    for (const id of [edge.from, edge.to]) {
      if (!nodes.has(id)) {
        nodes.set(id, {
          blockId: id,
          pos: 0,
          nodeType: 'paragraph',
          text: '',
          headingPath: [],
          definedTerms: [],
        })
      }
      adjacency.set(id, [...(adjacency.get(id) ?? []), edge])
    }
  }
  return {
    contentHash: 'h',
    builtAt: 0,
    llmApplied: false,
    llmPartial: false,
    embeddingsApplied: false,
    embeddingsPartial: false,
    graphitiApplied: false,
    graphitiEpisodeGen: -1,
    blockHashes: new Map(),
    nodes,
    edges,
    adjacency,
  }
}

/** One deterministic edge between two blocks — the graph-scoping fixture. */
function graphWithEdge(from: string, to: string): DocGraph {
  return graphOf([{ from, to, type: 'depends-on', source: 'deterministic' }])
}

/** No edges — isolates the term-sharing recall floor from the graph lane. */
const EMPTY_GRAPH: DocGraph = graphOf([])

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
    // The union's discriminant is what downstream branches on, so pin it
    // rather than asserting the absence of a key nothing ever sets.
    expect(violations[0].checkKind).toBe('entailment')
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

  it('produces no flag when the real judge path yields zero verdicts', async () => {
    // Drives the REAL judge (not a hand-written empty Map, which
    // judgeEntailmentPairs can never actually return — it throws first), so
    // this exercises the malfunction path the production code really takes.
    const violations = await checkEntailmentInvariants(DOC, [invariantRecord()], CONFIG, {
      judge: (pairs, config) =>
        judgeEntailmentPairs(pairs, config, (async () => ({
          toolCalls: [{ name: 'not_a_verdict', input: {} }],
        })) as never),
      graph: EMPTY_GRAPH,
    })

    expect(violations).toEqual([])
  })

  it('produces no flag when the judge confirms an index that matches no candidate', async () => {
    const violations = await checkEntailmentInvariants(DOC, [invariantRecord()], CONFIG, {
      judge: (pairs, config) =>
        judgeEntailmentPairs(pairs, config, (async () => ({
          toolCalls: [
            { name: 'entailment_verdict', input: { index: 99, contradicts: true, reason: 'r' } },
            { name: 'entailment_verdict', input: { index: 1.7, contradicts: true, reason: 'r' } },
          ],
        })) as never),
      graph: EMPTY_GRAPH,
    })

    expect(violations).toEqual([])
  })

  it('never judges an invariant with no evidence links — the flag could not anchor anyway', async () => {
    const judge = judgeReturning({ contradicts: true, reason: 'r' })

    const violations = await checkEntailmentInvariants(
      DOC,
      [invariantRecord({ blockIds: JSON.stringify([]) })],
      CONFIG,
      { judge, graph: EMPTY_GRAPH },
    )

    expect(violations).toEqual([])
    expect(judge).not.toHaveBeenCalled()
  })

  it('caps the batch across invariants and names what it could not check', async () => {
    const blocks = [p('b-declare', DECLARE_TEXT)]
    for (let i = 0; i < 10; i++) {
      blocks.push(p(`b-${i}`, `Section ${i} also describes terminations in detail.`))
    }
    const doc = schema.node('doc', null, blocks)
    const invariants = Array.from({ length: 6 }, (_, i) =>
      invariantRecord({ id: `inv-${i}` }),
    )
    const judge = vi.fn(async (pairs: EntailmentPair[]) => {
      const map = new Map<number, EntailmentVerdict>()
      pairs.forEach((_, i) => map.set(i, { contradicts: false, reason: 'ok' }))
      return map
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await checkEntailmentInvariants(doc, invariants, CONFIG, { judge, graph: EMPTY_GRAPH })

    // Hard budget: never more than MAX_TOTAL_PAIRS passages in one batch.
    expect(judge.mock.calls[0][0].length).toBe(20)
    // Both the per-run invariant cap and the shared-budget starvation are
    // disclosed, not silently truncated.
    const warned = warn.mock.calls.map((c) => String(c[0])).join('\n')
    expect(warned).toMatch(/never reached/)
    expect(warned).toMatch(/batch budget/)
    warn.mockRestore()
  })

  it('never calls the judge for a row that is no longer active', async () => {
    const judge = judgeReturning({ contradicts: true, reason: 'should not be reached' })

    const violations = await checkEntailmentInvariants(
      DOC,
      [invariantRecord({ id: 'inv-resolved', status: 'resolved' })],
      CONFIG,
      { judge, graph: EMPTY_GRAPH },
    )

    expect(violations).toEqual([])
    expect(judge).not.toHaveBeenCalled()
  })

  it('judges whatever active rows the caller selected, kind included', () => {
    // Lane membership is the CALLER's call (invariantCascade decides which
    // deterministic-classified rows deserve a second look), so this function
    // must not second-guess checkKind — otherwise the fallthrough that closes
    // the plural/date hole would be silently filtered out here.
    const judge = judgeReturning({ contradicts: true, reason: 'conflicts' })

    return checkEntailmentInvariants(
      DOC,
      [invariantRecord({ id: 'inv-det', checkKind: 'deterministic' })],
      CONFIG,
      { judge, graph: EMPTY_GRAPH },
    ).then((violations) => {
      expect(judge).toHaveBeenCalled()
      expect(violations).toHaveLength(1)
    })
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
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pairs = selectCandidates(schema.node('doc', null, blocks), invariantRecord(), EMPTY_GRAPH)
    // Exactly the cap, not merely "at most" — an assertion that also passes on
    // an empty result would go green if selection were entirely broken.
    expect(pairs).toHaveLength(6)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('prefers the block matching more of the statement over mere document order', () => {
    const doc = schema.node('doc', null, [
      p('b-declare', DECLARE_TEXT),
      // Earlier in the document, but matches only "terminations".
      p('b-weak', 'Terminations are discussed in the appendix.'),
      // Later, but matches both "terminations" and "notice".
      p('b-strong', 'Terminations require notice of one and a half months.'),
    ])
    const pairs = selectCandidates(
      doc,
      invariantRecord({ statement: 'terminations now require thirty days notice' }),
      EMPTY_GRAPH,
    )
    expect(pairs[0].blockId).toBe('b-strong')
  })

  it('ranks a graph neighbor ahead of a block that only shares a term', () => {
    const doc = schema.node('doc', null, [
      p('b-declare', DECLARE_TEXT),
      p('b-term-only', 'Terminations are discussed in the appendix.'),
      p('b-neighbor', 'That period governs how much warning staff receive.'),
    ])
    // b-neighbor shares no statement term; it is reachable ONLY via the graph.
    const graph = graphWithEdge('b-declare', 'b-neighbor')

    const pairs = selectCandidates(doc, invariantRecord(), graph)

    expect(pairs.map((c) => c.blockId)).toEqual(['b-neighbor', 'b-term-only'])
  })

  it('reaches a graph neighbor that shares no wording with the statement at all', () => {
    const doc = schema.node('doc', null, [
      p('b-declare', DECLARE_TEXT),
      p('b-neighbor', 'That period governs how much warning staff receive.'),
    ])
    const graph = graphWithEdge('b-declare', 'b-neighbor')

    expect(selectCandidates(doc, invariantRecord(), graph).map((c) => c.blockId)).toEqual([
      'b-neighbor',
    ])
    // Without the graph the same block is unreachable — proving the
    // neighborhood lane, not the term floor, is what found it.
    expect(selectCandidates(doc, invariantRecord(), EMPTY_GRAPH)).toEqual([])
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
