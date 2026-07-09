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
