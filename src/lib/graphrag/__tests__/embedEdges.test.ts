import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'
import type { LLMConfig } from '@/stores/settingsStore'
import type { CallStructuredFn } from '@/lib/ai/structuredClient'
import {
  buildDeterministicGraph,
  getDocGraph,
  getNeighborhood,
  invalidateDocGraphCache,
} from '../docGraph'
import {
  augmentWithEmbeddingEdges,
  clearEmbeddingVectorCache,
  fetchEmbeddings,
  type EmbedFn,
} from '../embedEdges'

const CONFIG: LLMConfig = { provider: 'claude', apiKey: 'test-key', model: 'test-model' }

function p(blockId: string, text: string): PMNode {
  return schema.node('paragraph', { blockId }, [schema.text(text)])
}

function docOf(...blocks: PMNode[]): PMNode {
  return schema.node('doc', null, blocks)
}

// Deterministic unit-ish vectors keyed by block text:
// cos(alpha, gamma) = 0.98 (> 0.82), everything else involving delta ≈ 0.
const VECS: Record<string, number[]> = {
  'alpha topic text': [1, 0],
  'beta topic text': [0.99, 0.14],
  'gamma topic text': [0.98, 0.199],
  'delta topic text': [0, 1],
}

const FIXTURE_DOC = docOf(
  p('b0', 'alpha topic text'),
  p('b1', 'beta topic text'),
  p('b2', 'gamma topic text'),
  p('b3', 'delta topic text'),
)

function scriptedEmbed(calls?: string[][]): EmbedFn {
  return async (texts) => {
    calls?.push(texts)
    return texts.map((t) => VECS[t] ?? [0, 0])
  }
}

const scriptedStructured: CallStructuredFn = async () => ({ toolCalls: [] })

beforeEach(() => {
  invalidateDocGraphCache()
  clearEmbeddingVectorCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('augmentWithEmbeddingEdges', () => {
  it('links similar NON-adjacent blocks; skips doc-adjacent pairs and sub-threshold pairs', async () => {
    const graph = buildDeterministicGraph(FIXTURE_DOC)
    await augmentWithEmbeddingEdges(graph, CONFIG, scriptedEmbed())

    const embEdges = graph.edges.filter((e) => e.source === 'embedding')
    // b0–b2 is the only pair that is non-adjacent AND above 0.82.
    expect(embEdges).toHaveLength(1)
    expect(embEdges[0]).toMatchObject({
      from: 'b0',
      to: 'b2',
      type: 'duplicates',
      source: 'embedding',
      evidence: 'semantic similarity 0.98',
    })
    // b0–b1 is above threshold but doc-adjacent — never linked.
    expect(embEdges.some((e) => e.to === 'b1' || e.from === 'b1')).toBe(false)
    // Adjacency index updated so the cascade can traverse the new edge.
    expect(getNeighborhood(graph, 'b0', 1).has('b2')).toBe(true)
    expect(graph.embeddingsApplied).toBe(true)
  })

  it('skips graph-adjacent pairs even above the threshold (already connected)', async () => {
    const doc = docOf(
      p('g0', '"Alpha" means the retention window for records.'),
      p('g1', 'Completely unrelated filler block.'),
      p('g2', 'The Alpha applies to all backups.'),
    )
    const graph = buildDeterministicGraph(doc)
    // Sanity: the defined-term extractor already linked g2 → g0.
    expect(graph.adjacency.get('g0')?.some((e) => e.from === 'g2')).toBe(true)

    const embed: EmbedFn = async (texts) =>
      texts.map((t) => (t.includes('filler') ? [0, 1] : [1, 0])) // g0 ≡ g2
    await augmentWithEmbeddingEdges(graph, CONFIG, embed)
    expect(graph.edges.filter((e) => e.source === 'embedding')).toHaveLength(0)
    expect(graph.embeddingsApplied).toBe(true)
  })

  it('null embed result (unsupported provider) → no edges, no throw, marked applied', async () => {
    const graph = buildDeterministicGraph(FIXTURE_DOC)
    const before = graph.edges.length
    await augmentWithEmbeddingEdges(graph, CONFIG, async () => null)
    expect(graph.edges).toHaveLength(before)
    expect(graph.embeddingsApplied).toBe(true) // silent no-op — no retry loop
  })

  it('a throwing embed fn is swallowed and left unapplied for a later retry', async () => {
    const graph = buildDeterministicGraph(FIXTURE_DOC)
    const before = graph.edges.length
    await augmentWithEmbeddingEdges(graph, CONFIG, async () => {
      throw new Error('transport down')
    })
    expect(graph.edges).toHaveLength(before)
    expect(graph.embeddingsApplied).toBe(false)
  })

  it('vector cache: a rebuild embeds ONLY blocks whose text changed', async () => {
    const calls: string[][] = []
    const embed = scriptedEmbed(calls)

    const g1 = buildDeterministicGraph(FIXTURE_DOC)
    await augmentWithEmbeddingEdges(g1, CONFIG, embed)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toHaveLength(4)

    const edited = docOf(
      p('b0', 'alpha topic text'),
      p('b1', 'beta topic text'),
      p('b2', 'gamma topic text'),
      p('b3', 'delta topic text revised'),
    )
    const g2 = buildDeterministicGraph(edited)
    await augmentWithEmbeddingEdges(g2, CONFIG, embed)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual(['delta topic text revised']) // cache hit for the rest
    // Cached vectors still produce the b0–b2 edge without re-embedding them.
    expect(g2.edges.some((e) => e.source === 'embedding' && e.from === 'b0' && e.to === 'b2')).toBe(
      true,
    )
  })
})

describe('fetchEmbeddings', () => {
  it('501 from /api/embed (claude has no embeddings API) → null, silent no-op', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ reason: 'unsupported' }), { status: 501 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const out = await fetchEmbeddings(['some text'], CONFIG)
    expect(out).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/embed')
    expect((init.headers as Record<string, string>)['x-provider']).toBe('claude')
  })

  it('200 with vectors → returns them; network failure → null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ vectors: [[1, 0]] }), { status: 200 })),
    )
    expect(await fetchEmbeddings(['x'], CONFIG)).toEqual([[1, 0]])

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    expect(await fetchEmbeddings(['x'], CONFIG)).toBeNull()
  })
})

describe('getDocGraph — embedding pass wiring', () => {
  it('runs the embedding pass after the LLM pass and merges its edges', async () => {
    const graph = await getDocGraph(FIXTURE_DOC, CONFIG, {
      callStructured: scriptedStructured,
      embed: scriptedEmbed(),
      embeddingsEnabled: true,
    })
    expect(graph.llmApplied).toBe(true)
    expect(graph.embeddingsApplied).toBe(true)
    expect(graph.edges.some((e) => e.source === 'embedding')).toBe(true)
  })

  it('embeddingsEnabled=false skips the pass entirely', async () => {
    const embed = vi.fn(scriptedEmbed())
    const graph = await getDocGraph(FIXTURE_DOC, CONFIG, {
      callStructured: scriptedStructured,
      embed,
      embeddingsEnabled: false,
    })
    expect(embed).not.toHaveBeenCalled()
    expect(graph.embeddingsApplied).toBe(false)
    expect(graph.edges.some((e) => e.source === 'embedding')).toBe(false)
  })

  it('skipEmbeddings (background rebuild path) skips regardless of the setting', async () => {
    const embed = vi.fn(scriptedEmbed())
    const graph = await getDocGraph(FIXTURE_DOC, CONFIG, {
      callStructured: scriptedStructured,
      skipLlm: true,
      skipEmbeddings: true,
      embed,
      embeddingsEnabled: true,
    })
    expect(embed).not.toHaveBeenCalled()
    expect(graph.embeddingsApplied).toBe(false)
  })

  it('settings store ships embeddingsEnabled default-on with a setter (UI toggle lands in Wave C)', async () => {
    const { useSettingsStore } = await import('@/stores/settingsStore')
    expect(useSettingsStore.getState().embeddingsEnabled).toBe(true)
    useSettingsStore.getState().setEmbeddingsEnabled(false)
    expect(useSettingsStore.getState().embeddingsEnabled).toBe(false)
    useSettingsStore.getState().setEmbeddingsEnabled(true) // restore for other tests
  })
})
