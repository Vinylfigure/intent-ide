import { describe, it, expect, beforeEach, vi } from 'vitest'
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

  it("extraction runs on the USER's selected model — never a silent cheap-model downgrade", async () => {
    // Edge extraction is the cascade's recall mechanism for paraphrase
    // dependencies; downgrading it would be unmeasured recall loss.
    const seen: string[] = []
    const capturingCall: CallStructuredFn = async (_req, config) => {
      seen.push(config.model)
      return { toolCalls: [] }
    }
    await augmentWithLlmEdges(
      buildDeterministicGraph(doc),
      { provider: 'claude', apiKey: 'k', model: 'claude-fable-5' },
      capturingCall,
    )
    await augmentWithLlmEdges(
      buildDeterministicGraph(doc),
      { provider: 'ollama', apiKey: '', model: 'llama3.2' },
      capturingCall,
    )
    expect(seen).toEqual(['claude-fable-5', 'llama3.2'])
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

describe('augmentWithLlmEdges — chunking (no silent large-doc skip)', () => {
  const mkDoc = (n: number) =>
    docOf(...Array.from({ length: n }, (_, i) => p(`b${i}`, `distinct sentence number ${i}.`)))

  function capturing(capture: StructuredRequest[]): CallStructuredFn {
    return async (req) => {
      capture.push(req)
      return { toolCalls: [] }
    }
  }

  it('one call for docs at or under the chunk size', async () => {
    const captured: StructuredRequest[] = []
    const graph = buildDeterministicGraph(mkDoc(40))
    await augmentWithLlmEdges(graph, CONFIG, capturing(captured))
    expect(captured).toHaveLength(1)
    expect(graph.llmApplied).toBe(true)
    expect(graph.llmPartial).toBe(false)
  })

  it('60-block doc: two contiguous chunks with a 4-block overlap for cross-boundary stitching', async () => {
    const captured: StructuredRequest[] = []
    const graph = buildDeterministicGraph(mkDoc(60))
    await augmentWithLlmEdges(graph, CONFIG, capturing(captured))
    expect(captured).toHaveLength(2)
    const [first, second] = captured.map((r) => r.messages.map((m) => m.content).join('\n'))
    // Chunk 1: blocks 0–39.
    expect(first).toContain('[b0]')
    expect(first).toContain('[b39]')
    expect(first).not.toContain('[b40]')
    // Chunk 2 starts 4 blocks back (36) and runs to the end.
    expect(second).toContain('[b36]')
    expect(second).toContain('[b39]') // the shared overlap
    expect(second).toContain('[b59]')
    expect(second).not.toContain('[b35]')
    expect(graph.llmApplied).toBe(true)
    expect(graph.llmPartial).toBe(false)
  })

  it('201-block doc (the old silent-skip regime) is now fully covered by chunked calls', async () => {
    const captured: StructuredRequest[] = []
    const graph = buildDeterministicGraph(mkDoc(201))
    await augmentWithLlmEdges(graph, CONFIG, capturing(captured))
    expect(captured).toHaveLength(6) // ceil((201 - 40) / 36) + 1
    expect(graph.llmApplied).toBe(true)
    expect(graph.llmPartial).toBe(false)
    const all = captured.flatMap((r) => r.messages).map((m) => m.content).join('\n')
    expect(all).toContain('[b200]') // the last block IS analyzed
  })

  it('350-block doc: capped at 8 calls, llmPartial set, console.warn — never a silent truncation', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const captured: StructuredRequest[] = []
      const graph = buildDeterministicGraph(mkDoc(350))
      await augmentWithLlmEdges(graph, CONFIG, capturing(captured))
      expect(captured).toHaveLength(8)
      expect(graph.llmApplied).toBe(true)
      expect(graph.llmPartial).toBe(true)
      expect(warn).toHaveBeenCalledTimes(1)
      // 8 chunks cover blocks 0–291 (7 × 36 stride + 40) → 58 skipped, named.
      expect(String(warn.mock.calls[0][0])).toContain('58 of 350')
      expect(String(warn.mock.calls[0][0])).toContain('[b292]')
    } finally {
      warn.mockRestore()
    }
  })

  it('mid-pass chunk failure keeps earlier edges, leaves llmApplied false; retry dedupes', async () => {
    const graph = buildDeterministicGraph(mkDoc(60)) // 2 chunks
    let calls = 0
    const flaky: CallStructuredFn = async () => {
      calls++
      if (calls === 2) throw new Error('provider down')
      return {
        toolCalls: [
          {
            name: 'link_blocks',
            input: { from_block_id: 'b0', to_block_id: 'b50', edge_type: 'references' },
          },
        ],
      }
    }
    await augmentWithLlmEdges(graph, CONFIG, flaky)
    expect(graph.llmApplied).toBe(false)
    expect(graph.edges.filter((e) => e.source === 'llm')).toHaveLength(1)

    await augmentWithLlmEdges(graph, CONFIG, flaky) // both chunks succeed now
    expect(graph.llmApplied).toBe(true)
    // The retry re-reported the same edge — dedupe kept exactly one.
    expect(graph.edges.filter((e) => e.source === 'llm')).toHaveLength(1)
  })
})

describe('getDocGraph — incremental per-block updates', () => {
  /** n paragraphs `${prefix}0..n-1` with per-index text overrides. */
  function bigDoc(prefix: string, n: number, overrides: Record<number, string> = {}) {
    return docOf(
      ...Array.from({ length: n }, (_, i) =>
        p(`${prefix}${i}`, overrides[i] ?? `Unique filler paragraph number ${i} content.`),
      ),
    )
  }

  it('re-extracts ONLY the changed block + its 1-hop neighbors; unchanged LLM edges survive', async () => {
    const base = {
      2: '"Alpha" means the retention window for records.',
      5: 'The Alpha applies to all backups made after launch.',
    }
    const doc1 = bigDoc('b', 30, base)
    // First build: full pass; the model links two blocks the extractors cannot.
    const g1 = await getDocGraph(doc1, CONFIG, {
      callStructured: scripted([
        {
          name: 'link_blocks',
          input: { from_block_id: 'b10', to_block_id: 'b11', edge_type: 'depends-on' },
        },
      ]),
    })
    expect(g1.llmApplied).toBe(true)
    expect(g1.edges.some((e) => e.source === 'llm' && e.from === 'b10')).toBe(true)

    // Edit exactly one block (b5) — still references the Alpha definition (b2).
    const doc2 = bigDoc('b', 30, {
      ...base,
      5: 'The Alpha applies to all backups made before launch.',
    })
    const captured: StructuredRequest[] = []
    const g2 = await getDocGraph(doc2, CONFIG, { callStructured: scripted([], captured) })

    // One extraction call over the changed block + its graph neighbor only.
    expect(captured).toHaveLength(1)
    const prompt = captured[0].messages.map((m) => m.content).join('\n')
    expect(prompt).toContain('[b5]')
    expect(prompt).toContain('[b2]') // 1-hop neighbor via the Alpha reference edge
    expect(prompt).not.toContain('[b10]') // unchanged, unconnected — never re-sent
    expect(prompt).not.toContain('Unique filler paragraph number 20') // far block text absent

    // The prior LLM edge between two unchanged blocks was carried forward.
    const carried = g2.edges.find((e) => e.source === 'llm' && e.from === 'b10')
    expect(carried).toMatchObject({ from: 'b10', to: 'b11', type: 'depends-on' })
    expect(g2.llmApplied).toBe(true)
    expect(g2.llmPartial).toBe(false)
  })

  it('overlap matching picks the RIGHT prior graph out of several cached ones', async () => {
    const docA = bigDoc('a', 10)
    const docC = bigDoc('c', 10)
    await getDocGraph(docA, CONFIG, {
      callStructured: scripted([
        { name: 'link_blocks', input: { from_block_id: 'a3', to_block_id: 'a4', edge_type: 'depends-on' } },
      ]),
    })
    await getDocGraph(docC, CONFIG, {
      callStructured: scripted([
        { name: 'link_blocks', input: { from_block_id: 'c3', to_block_id: 'c4', edge_type: 'duplicates' } },
      ]),
    })

    // Edit one block of doc A: its prior graph (9/10 overlap) must be chosen.
    const docA2 = bigDoc('a', 10, { 7: 'Rewritten seventh paragraph.' })
    const captured: StructuredRequest[] = []
    const g = await getDocGraph(docA2, CONFIG, { callStructured: scripted([], captured) })

    expect(captured).toHaveLength(1)
    const prompt = captured[0].messages.map((m) => m.content).join('\n')
    expect(prompt).toContain('[a7]')
    expect(prompt).not.toContain('[a0]') // incremental against A, not a fresh full pass
    expect(g.edges.some((e) => e.source === 'llm' && e.from === 'a3' && e.to === 'a4')).toBe(true)
    expect(g.edges.some((e) => e.from === 'c3')).toBe(false)
  })

  it('below the >50% overlap threshold the build is treated as fresh (full pass, nothing carried)', async () => {
    const docA = bigDoc('a', 10)
    await getDocGraph(docA, CONFIG, {
      callStructured: scripted([
        { name: 'link_blocks', input: { from_block_id: 'a8', to_block_id: 'a9', edge_type: 'depends-on' } },
      ]),
    })

    // 6 of 10 blocks rewritten → only 40% overlap with the cached graph.
    const docD = bigDoc(
      'a',
      10,
      Object.fromEntries(
        Array.from({ length: 6 }, (_, i) => [i, `Completely rewritten paragraph ${i}.`]),
      ),
    )
    const captured: StructuredRequest[] = []
    const g = await getDocGraph(docD, CONFIG, { callStructured: scripted([], captured) })

    const prompt = captured.flatMap((r) => r.messages).map((m) => m.content).join('\n')
    // Unchanged, unconnected blocks are in the listing — proof of a FULL pass.
    expect(prompt).toContain('[a6]')
    expect(prompt).toContain('[a9]')
    // Nothing carried forward from a graph that isn't the same document.
    expect(g.edges.some((e) => e.source === 'llm')).toBe(false)
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
