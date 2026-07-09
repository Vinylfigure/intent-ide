import { describe, it, expect, beforeEach } from 'vitest'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'
import type { LLMConfig } from '@/stores/settingsStore'
import type { CallStructuredFn, StructuredRequest } from '@/lib/ai/structuredClient'
import {
  buildDeterministicGraph,
  augmentWithLlmEdges,
  getDocGraph,
  getNeighborhood,
  contentHash,
  invalidateDocGraphCache,
} from '../docGraph'

const CONFIG: LLMConfig = { provider: 'claude', apiKey: 'test-key', model: 'test-model' }

function p(blockId: string, text: string): PMNode {
  return schema.node('paragraph', { blockId }, [schema.text(text)])
}

function h(blockId: string, level: number, text: string): PMNode {
  return schema.node('heading', { level, blockId }, [schema.text(text)])
}

function docOf(...blocks: PMNode[]): PMNode {
  return schema.node('doc', null, blocks)
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

beforeEach(() => {
  invalidateDocGraphCache()
})

describe('buildDeterministicGraph', () => {
  it('creates a node per textblock keyed by blockId', () => {
    const graph = buildDeterministicGraph(docOf(p('b1', 'one'), h('b2', 1, 'Title'), p('b3', 'two')))
    expect([...graph.nodes.keys()]).toEqual(['b1', 'b2', 'b3'])
    expect(graph.nodes.get('b2')!.nodeType).toBe('heading')
  })

  it('links defined terms: "X means ..." definition referenced by other blocks', () => {
    const graph = buildDeterministicGraph(
      docOf(
        p('def', '"Retention Period" means the ninety day window after termination.'),
        p('use', 'Backups are purged when the Retention Period ends.'),
        p('unrelated', 'The weather is nice.'),
      ),
    )
    const edge = graph.edges.find((e) => e.from === 'use' && e.to === 'def')
    expect(edge).toBeDefined()
    expect(edge!.type).toBe('references')
    expect(edge!.evidence).toBe('Retention Period')
    expect(graph.edges.some((e) => e.from === 'unrelated' || e.to === 'unrelated')).toBe(false)
  })

  it('resolves "see Section N" to the Nth heading', () => {
    const graph = buildDeterministicGraph(
      docOf(
        h('h1', 1, 'Introduction'),
        p('p1', 'Intro text.'),
        h('h2', 1, 'Data Handling'),
        p('p2', 'Handling text.'),
        p('p3', 'Details are covered in Section 2 of this document.'),
      ),
    )
    const edge = graph.edges.find((e) => e.from === 'p3' && e.to === 'h2')
    expect(edge).toBeDefined()
    expect(edge!.type).toBe('references')
  })

  it('resolves named references against heading titles', () => {
    const graph = buildDeterministicGraph(
      docOf(
        h('h1', 1, 'Data Handling'),
        p('p1', 'Handling text.'),
        p('p2', 'Constraints are listed under "Data Handling" above.'),
      ),
    )
    expect(graph.edges.some((e) => e.from === 'p2' && e.to === 'h1')).toBe(true)
  })

  it('links duplicated sentences across blocks', () => {
    const sentence = 'All customer records are encrypted at rest using AES-256.'
    const graph = buildDeterministicGraph(
      docOf(p('a', `${sentence} More text here.`), p('b', `${sentence} That is our policy.`)),
    )
    const edge = graph.edges.find((e) => e.type === 'duplicates')
    expect(edge).toBeDefined()
    expect([edge!.from, edge!.to].sort()).toEqual(['a', 'b'])
  })

  it('records heading paths for blocks under headings', () => {
    const graph = buildDeterministicGraph(
      docOf(h('h1', 1, 'Top'), h('h2', 2, 'Nested'), p('p1', 'body')),
    )
    expect(graph.nodes.get('p1')!.headingPath).toEqual(['Top', 'Nested'])
    expect(graph.nodes.get('h2')!.headingPath).toEqual(['Top'])
  })
})

describe('contentHash boundaries', () => {
  it('field separators keep block boundaries unambiguous (no concatenation collisions)', () => {
    // Without separators between blockId/text fields these two pairs would
    // hash identically ("a·foo·b·bar" vs "a·foob·b·ar" and "ax·foo" vs "a·xfoo").
    expect(contentHash(docOf(p('a', 'foo'), p('b', 'bar')))).not.toBe(
      contentHash(docOf(p('a', 'foob'), p('b', 'ar'))),
    )
    expect(contentHash(docOf(p('ax', 'foo')))).not.toBe(contentHash(docOf(p('a', 'xfoo'))))
    // Sanity: identical content hashes identically.
    expect(contentHash(docOf(p('a', 'foo'), p('b', 'bar')))).toBe(
      contentHash(docOf(p('a', 'foo'), p('b', 'bar'))),
    )
  })

  it('empty doc (single unstamped paragraph): stable hash, zero graph nodes, LLM pass skipped', async () => {
    const empty = schema.node('doc', null, [schema.node('paragraph')])
    const hash = contentHash(empty)
    expect(typeof hash).toBe('string')
    expect(hash.length).toBeGreaterThan(0)
    expect(hash).toBe(contentHash(schema.node('doc', null, [schema.node('paragraph')])))

    const graph = buildDeterministicGraph(empty)
    expect(graph.nodes.size).toBe(0)
    expect(graph.edges).toHaveLength(0)

    let called = false
    await augmentWithLlmEdges(graph, CONFIG, async () => {
      called = true
      return { toolCalls: [] }
    })
    expect(called).toBe(false)
    expect(graph.llmApplied).toBe(false)
  })
})

describe('getNeighborhood', () => {
  it('returns BFS hop distances bounded by the hop cap', () => {
    // chain: a — b — c — d
    const graph = buildDeterministicGraph(
      docOf(
        p('a', '"Alpha" means the first thing. Beta appears here.'),
        p('b', '"Beta" means the second thing. Gamma appears here.'),
        p('c', '"Gamma" means the third thing. Delta appears here.'),
        p('d', '"Delta" means the fourth thing.'),
      ),
    )
    const twoHops = getNeighborhood(graph, 'a', 2)
    expect(twoHops.get('a')).toBe(0)
    expect(twoHops.get('b')).toBe(1)
    expect(twoHops.get('c')).toBe(2)
    expect(twoHops.has('d')).toBe(false)
    const threeHops = getNeighborhood(graph, 'a', 3)
    expect(threeHops.get('d')).toBe(3)
  })

  it('returns empty map for unknown block', () => {
    const graph = buildDeterministicGraph(docOf(p('a', 'text')))
    expect(getNeighborhood(graph, 'nope', 2).size).toBe(0)
  })

  it('hops=0 returns only the block itself; negative hops behave the same', () => {
    const graph = buildDeterministicGraph(
      docOf(p('a', '"Alpha" means the first thing.'), p('b', 'Alpha appears here.')),
    )
    // Sanity: a and b really are connected.
    expect(getNeighborhood(graph, 'b', 1).has('a')).toBe(true)
    expect([...getNeighborhood(graph, 'b', 0).entries()]).toEqual([['b', 0]])
    expect([...getNeighborhood(graph, 'b', -1).entries()]).toEqual([['b', 0]])
  })
})

describe('augmentWithLlmEdges', () => {
  const doc = docOf(p('b1', 'The budget is $50,000.'), p('b2', 'We spend half the budget on hosting.'))

  it('merges validated LLM edges and flips llmApplied', async () => {
    const graph = buildDeterministicGraph(doc)
    await augmentWithLlmEdges(
      graph,
      CONFIG,
      scripted([
        {
          name: 'link_blocks',
          input: {
            from_block_id: 'b2',
            to_block_id: 'b1',
            edge_type: 'depends-on',
            quoted_text: 'half the budget',
          },
        },
      ]),
    )
    expect(graph.llmApplied).toBe(true)
    const edge = graph.edges.find((e) => e.source === 'llm')
    expect(edge).toMatchObject({ from: 'b2', to: 'b1', type: 'depends-on', evidence: 'half the budget' })
    // adjacency rebuilt
    expect(getNeighborhood(graph, 'b1', 1).has('b2')).toBe(true)
  })

  it('drops edges with unknown block ids or invalid edge types, keeps unverifiable quotes without evidence', async () => {
    const graph = buildDeterministicGraph(doc)
    await augmentWithLlmEdges(
      graph,
      CONFIG,
      scripted([
        { name: 'link_blocks', input: { from_block_id: 'ghost', to_block_id: 'b1', edge_type: 'references' } },
        { name: 'link_blocks', input: { from_block_id: 'b2', to_block_id: 'b1', edge_type: 'invents' } },
        { name: 'link_blocks', input: { from_block_id: 'b2', to_block_id: 'b2', edge_type: 'references' } },
        {
          name: 'link_blocks',
          input: {
            from_block_id: 'b2',
            to_block_id: 'b1',
            edge_type: 'references',
            quoted_text: 'this text is not in the block',
          },
        },
      ]),
    )
    const llmEdges = graph.edges.filter((e) => e.source === 'llm')
    expect(llmEdges).toHaveLength(1)
    expect(llmEdges[0]).toMatchObject({ from: 'b2', to: 'b1', type: 'references' })
    expect(llmEdges[0].evidence).toBeUndefined()
  })

  it('leaves the deterministic graph intact when the call throws', async () => {
    const graph = buildDeterministicGraph(doc)
    const before = graph.edges.length
    await augmentWithLlmEdges(graph, CONFIG, async () => {
      throw new Error('network down')
    })
    expect(graph.llmApplied).toBe(false)
    expect(graph.edges).toHaveLength(before)
  })

  it('skips the pass above 200 textblocks but still runs at exactly 200 (cap boundary)', async () => {
    const mkDoc = (n: number) =>
      docOf(...Array.from({ length: n }, (_, i) => p(`b${i}`, `distinct sentence number ${i}.`)))
    let calls = 0
    const counting: CallStructuredFn = async () => {
      calls++
      return { toolCalls: [] }
    }

    const over = buildDeterministicGraph(mkDoc(201))
    expect(over.nodes.size).toBe(201)
    await augmentWithLlmEdges(over, CONFIG, counting)
    expect(calls).toBe(0)
    expect(over.llmApplied).toBe(false) // deterministic-only, never flips

    const atCap = buildDeterministicGraph(mkDoc(200))
    await augmentWithLlmEdges(atCap, CONFIG, counting)
    expect(calls).toBe(1)
    expect(atCap.llmApplied).toBe(true)
  })

  it('skips silently when no API key is configured (non-ollama)', async () => {
    const graph = buildDeterministicGraph(doc)
    let called = false
    await augmentWithLlmEdges(graph, { ...CONFIG, apiKey: '' }, async () => {
      called = true
      return { toolCalls: [] }
    })
    expect(called).toBe(false)
    expect(graph.llmApplied).toBe(false)
  })
})

describe('getDocGraph cache', () => {
  it('hits the cache for identical content and rebuilds after an edit', async () => {
    const doc1 = docOf(p('b1', 'stable text'))
    let calls = 0
    const counting: CallStructuredFn = async () => {
      calls++
      return { toolCalls: [] }
    }
    const g1 = await getDocGraph(doc1, CONFIG, { callStructured: counting })
    const g2 = await getDocGraph(doc1, CONFIG, { callStructured: counting })
    expect(g2).toBe(g1)
    expect(calls).toBe(1)

    const doc2 = docOf(p('b1', 'edited text'))
    expect(contentHash(doc2)).not.toBe(contentHash(doc1))
    const g3 = await getDocGraph(doc2, CONFIG, { callStructured: counting })
    expect(g3).not.toBe(g1)
    expect(calls).toBe(2)
  })

  it('dedupes concurrent builds of the same content', async () => {
    const doc = docOf(p('b1', 'concurrent'))
    let calls = 0
    const slow: CallStructuredFn = async () => {
      calls++
      await new Promise((r) => setTimeout(r, 10))
      return { toolCalls: [] }
    }
    const [g1, g2] = await Promise.all([
      getDocGraph(doc, CONFIG, { callStructured: slow }),
      getDocGraph(doc, CONFIG, { callStructured: slow }),
    ])
    expect(g1).toBe(g2)
    expect(calls).toBe(1)
  })

  it('skipLlm builds a deterministic-only graph without calling the model', async () => {
    const doc = docOf(p('b1', 'no llm'))
    let called = false
    const g = await getDocGraph(doc, CONFIG, {
      skipLlm: true,
      callStructured: async () => {
        called = true
        return { toolCalls: [] }
      },
    })
    expect(called).toBe(false)
    expect(g.llmApplied).toBe(false)
    expect(g.nodes.has('b1')).toBe(true)
  })
})
