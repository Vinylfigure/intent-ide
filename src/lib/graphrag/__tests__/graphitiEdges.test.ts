import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'
import type { LLMConfig } from '@/stores/settingsStore'
import {
  buildDeterministicGraph,
  augmentWithGraphitiEdges,
  getDocGraph,
  invalidateDocGraphCache,
  type GraphitiEdgeDeps,
} from '../docGraph'
import type { GraphNode, SubgraphResult } from '@/lib/mcp/graphitiClient'

const CONFIG: LLMConfig = { provider: 'claude', apiKey: 'test-key', model: 'test-model' }

function p(blockId: string, text: string): PMNode {
  return schema.node('paragraph', { blockId }, [schema.text(text)])
}

function docOf(...blocks: PMNode[]): PMNode {
  return schema.node('doc', null, blocks)
}

function entity(name: string, uuid = `uuid-${name}`): GraphNode {
  return { uuid, name, summary: '' }
}

/** Scripted MCP client: fixed searchNodes hits + per-uuid subgraphs. */
function scriptedClient(
  hits: GraphNode[],
  subgraphs: Record<string, SubgraphResult> = {},
): Required<Pick<GraphitiEdgeDeps, 'searchNodes' | 'getSubgraph'>> {
  return {
    searchNodes: vi.fn(async () => hits),
    getSubgraph: vi.fn(async (uuid: string) => subgraphs[uuid] ?? { nodes: [], edges: [] }),
  }
}

beforeEach(() => {
  invalidateDocGraphCache()
})

describe('augmentWithGraphitiEdges', () => {
  it('links every pair of blocks mentioning a graph entity (references/graphiti, entity as evidence)', async () => {
    const graph = buildDeterministicGraph(
      docOf(
        p('b1', 'The Pilot Program starts in June.'),
        p('b2', 'Funding for the Pilot Program comes from reserves.'),
        p('b3', 'Unrelated logistics notes.'),
      ),
    )
    await augmentWithGraphitiEdges(graph, scriptedClient([entity('Pilot Program')]))

    const graphitiEdges = graph.edges.filter((e) => e.source === 'graphiti')
    expect(graphitiEdges).toEqual([
      { from: 'b1', to: 'b2', type: 'references', source: 'graphiti', evidence: 'Pilot Program' },
    ])
    // Adjacency rebuilt so the cascade neighborhood sees the new edge.
    expect(graph.adjacency.get('b1')).toContainEqual(graphitiEdges[0])
    expect(graph.graphitiApplied).toBe(true)
  })

  it('includes entities discovered via subgraph expansion', async () => {
    const graph = buildDeterministicGraph(
      docOf(
        p('b1', 'The Retention Window applies to backups.'),
        p('b2', 'Purge jobs respect the Retention Window.'),
      ),
    )
    const client = scriptedClient([entity('Primary Hit')], {
      'uuid-Primary Hit': { nodes: [entity('Retention Window')], edges: [] },
    })
    await augmentWithGraphitiEdges(graph, client)

    expect(graph.edges.filter((e) => e.source === 'graphiti')).toEqual([
      { from: 'b1', to: 'b2', type: 'references', source: 'graphiti', evidence: 'Retention Window' },
    ])
  })

  it('requires the entity name at word boundaries in ≥2 distinct blocks', async () => {
    const graph = buildDeterministicGraph(
      docOf(
        p('b1', 'Budget planning is ongoing.'),      // word-boundary mention
        p('b2', 'Budgetary constraints apply here.'), // substring only — no match
        p('b3', 'Nothing relevant.'),
      ),
    )
    await augmentWithGraphitiEdges(graph, scriptedClient([entity('Budget')]))
    // Only one true block mention ⇒ no pairs ⇒ no edges.
    expect(graph.edges.filter((e) => e.source === 'graphiti')).toEqual([])
  })

  it('skips stopword and short entity names', async () => {
    const graph = buildDeterministicGraph(
      docOf(
        p('b1', 'This section covers the API and this document.'),
        p('b2', 'That section also mentions the API and this document.'),
      ),
    )
    await augmentWithGraphitiEdges(
      graph,
      scriptedClient([entity('this'), entity('API'), entity('section'), entity('document')]),
    )
    // 'this'/'section'/'document' are stopwords; 'API' is under 4 chars.
    expect(graph.edges.filter((e) => e.source === 'graphiti')).toEqual([])
  })

  it('caps an entity to its first 10 blocks in document order (no pairwise firehose)', async () => {
    const blocks = Array.from({ length: 12 }, (_, i) =>
      p(`b${i + 1}`, `Clause ${i + 1} references the Total Budget figure.`),
    )
    const graph = buildDeterministicGraph(docOf(...blocks))
    await augmentWithGraphitiEdges(graph, scriptedClient([entity('Total Budget')]))

    const graphitiEdges = graph.edges.filter((e) => e.source === 'graphiti')
    expect(graphitiEdges).toHaveLength(45) // C(10, 2) — blocks 11/12 excluded
    const touched = new Set(graphitiEdges.flatMap((e) => [e.from, e.to]))
    expect(touched.has('b11')).toBe(false)
    expect(touched.has('b12')).toBe(false)
  })

  it('caps distinct processed entities at 12 per build (13th skipped, count-only warn)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      // 13 valid entities TermA01..TermA13, each mentioned in exactly 2 blocks.
      const blocks = Array.from({ length: 13 }, (_, i) => {
        const n = String(i + 1).padStart(2, '0')
        return [
          p(`x${n}`, `Clause about TermA${n} begins here.`),
          p(`y${n}`, `Later clause repeats TermA${n} verbatim.`),
        ]
      }).flat()
      const graph = buildDeterministicGraph(docOf(...blocks))
      // Hub hit is under the 4-char minimum, so it is skipped (not processed)
      // and the 13 subgraph-discovered entities arrive in insertion order.
      const client = scriptedClient([entity('API')], {
        'uuid-API': {
          nodes: Array.from({ length: 13 }, (_, i) =>
            entity(`TermA${String(i + 1).padStart(2, '0')}`),
          ),
          edges: [],
        },
      })
      await augmentWithGraphitiEdges(graph, client)

      const graphitiEdges = graph.edges.filter((e) => e.source === 'graphiti')
      expect(graphitiEdges).toHaveLength(12) // one edge per processed entity
      const evidences = new Set(graphitiEdges.map((e) => e.evidence))
      expect(evidences.has('TermA12')).toBe(true)
      expect(evidences.has('TermA13')).toBe(false) // the 13th was never processed
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain('entity cap')
      expect(String(warn.mock.calls[0][0])).toContain('12')
      expect(graph.graphitiApplied).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })

  it('caps total graphiti edges at 120 per build (count-only warn, no silent firehose)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      // 3 entities × 10 disjoint mentioning blocks = 3 × C(10,2) = 135 potential edges.
      const mk = (term: string, prefix: string) =>
        Array.from({ length: 10 }, (_, i) =>
          p(`${prefix}${i}`, `Clause ${i} of this section cites the ${term} figure.`),
        )
      const graph = buildDeterministicGraph(
        docOf(...mk('AlphaTotal', 'a'), ...mk('BetaTotal', 'b'), ...mk('GammaTotal', 'c')),
      )
      await augmentWithGraphitiEdges(
        graph,
        scriptedClient([entity('AlphaTotal'), entity('BetaTotal'), entity('GammaTotal')]),
      )

      const graphitiEdges = graph.edges.filter((e) => e.source === 'graphiti')
      expect(graphitiEdges).toHaveLength(120)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain('edge cap')
      expect(String(warn.mock.calls[0][0])).toContain('120')
      expect(graph.graphitiApplied).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })

  it('reversed duplicates of deterministic term edges are deduped (direction-normalized key)', async () => {
    // Deterministic pass 2b creates use→def ('references', evidence term). The
    // graphiti pair walks blocks in DOC order, producing def→use — the reverse
    // orientation of the same relationship, which must not become a parallel edge.
    const graph = buildDeterministicGraph(
      docOf(
        p('def', '"Pilot Program" means the trial rollout.'),
        p('use', 'Funding for the Pilot Program comes from reserves.'),
      ),
    )
    expect(graph.edges).toEqual([
      {
        from: 'use',
        to: 'def',
        type: 'references',
        source: 'deterministic',
        evidence: 'Pilot Program',
      },
    ])
    await augmentWithGraphitiEdges(graph, scriptedClient([entity('Pilot Program')]))
    expect(graph.edges.filter((e) => e.source === 'graphiti')).toEqual([])
    expect(graph.edges).toHaveLength(1) // still just the deterministic edge
    expect(graph.graphitiApplied).toBe(true)
  })

  it('threads an AbortSignal to the client and aborts in-flight calls at the deadline', async () => {
    const graph = buildDeterministicGraph(
      docOf(p('b1', 'Alpha Term here.'), p('b2', 'Alpha Term there.')),
    )
    const subgraphCalls: string[] = []
    let searchSignal: AbortSignal | undefined
    await augmentWithGraphitiEdges(graph, {
      searchNodes: async (_q, _l, signal) => {
        searchSignal = signal
        return [entity('E-one'), entity('E-two'), entity('E-three')]
      },
      // Honors the signal: pends until aborted, then rejects.
      getSubgraph: (uuid, _radius, signal) => {
        subgraphCalls.push(uuid)
        return new Promise((_, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
      },
      timeoutMs: 20,
    })
    expect(searchSignal).toBeInstanceOf(AbortSignal)
    expect(searchSignal!.aborted).toBe(true)
    expect(graph.graphitiApplied).toBe(false)
    // Give any would-be zombie continuation time to fire further calls.
    await new Promise((r) => setTimeout(r, 40))
    expect(subgraphCalls).toEqual(['uuid-E-one']) // sequential calls stopped at the abort
  })

  it('stops zombie sequential getSubgraph calls even when the client ignores the signal', async () => {
    // The client resolves AFTER the deadline without honoring the abort — the
    // pass must still stop between calls via the signal.aborted check instead
    // of walking all three subgraphs in the background.
    const graph = buildDeterministicGraph(
      docOf(p('b1', 'Alpha Term here.'), p('b2', 'Alpha Term there.')),
    )
    const subgraphCalls: string[] = []
    await augmentWithGraphitiEdges(graph, {
      searchNodes: async () => [entity('E-one'), entity('E-two'), entity('E-three')],
      getSubgraph: async (uuid) => {
        subgraphCalls.push(uuid)
        await new Promise((r) => setTimeout(r, 40)) // outlives the deadline
        return { nodes: [], edges: [] }
      },
      timeoutMs: 15,
    })
    expect(graph.graphitiApplied).toBe(false)
    await new Promise((r) => setTimeout(r, 120))
    expect(subgraphCalls).toEqual(['uuid-E-one'])
  })

  it('returns silently (no edges, no throw) when the MCP client fails', async () => {
    const graph = buildDeterministicGraph(
      docOf(p('b1', 'Alpha Term here.'), p('b2', 'Alpha Term there.')),
    )
    const before = graph.edges.length
    await expect(
      augmentWithGraphitiEdges(graph, {
        searchNodes: async () => {
          throw new Error('ECONNREFUSED')
        },
        getSubgraph: async () => ({ nodes: [], edges: [] }),
      }),
    ).resolves.toBeUndefined()
    expect(graph.edges).toHaveLength(before)
    expect(graph.graphitiApplied).toBe(false) // retryable on a later build
  })

  it('returns silently when the MCP call exceeds the deadline', async () => {
    const graph = buildDeterministicGraph(
      docOf(p('b1', 'Alpha Term here.'), p('b2', 'Alpha Term there.')),
    )
    await augmentWithGraphitiEdges(graph, {
      searchNodes: () => new Promise(() => {}), // hangs forever
      getSubgraph: async () => ({ nodes: [], edges: [] }),
      timeoutMs: 20,
    })
    expect(graph.edges.filter((e) => e.source === 'graphiti')).toEqual([])
    expect(graph.graphitiApplied).toBe(false)
  })

  it('is a no-op when already applied', async () => {
    const graph = buildDeterministicGraph(
      docOf(p('b1', 'Alpha Term here.'), p('b2', 'Alpha Term there.')),
    )
    const client = scriptedClient([entity('Alpha Term')])
    await augmentWithGraphitiEdges(graph, client)
    await augmentWithGraphitiEdges(graph, client)
    expect(client.searchNodes).toHaveBeenCalledTimes(1)
    expect(graph.edges.filter((e) => e.source === 'graphiti')).toHaveLength(1)
  })
})

describe('getDocGraph graphiti wiring', () => {
  it('runs the graphiti pass on user-initiated builds', async () => {
    const client = scriptedClient([entity('Alpha Term')])
    const graph = await getDocGraph(
      docOf(p('b1', 'Alpha Term here.'), p('b2', 'Alpha Term there.')),
      CONFIG,
      { skipLlm: true, embeddingsEnabled: false, graphiti: client },
    )
    expect(client.searchNodes).toHaveBeenCalledTimes(1)
    expect(graph.edges.filter((e) => e.source === 'graphiti')).toHaveLength(1)
    expect(graph.graphitiApplied).toBe(true)
  })

  it('background rebuilds skip the graphiti pass entirely (skipGraphiti)', async () => {
    const client = scriptedClient([entity('Alpha Term')])
    const graph = await getDocGraph(
      docOf(p('b1', 'Alpha Term here.'), p('b2', 'Alpha Term there.')),
      CONFIG,
      { skipLlm: true, skipEmbeddings: true, skipGraphiti: true, graphiti: client },
    )
    expect(client.searchNodes).not.toHaveBeenCalled()
    expect(graph.edges.filter((e) => e.source === 'graphiti')).toEqual([])
    expect(graph.graphitiApplied).toBe(false)
  })
})
