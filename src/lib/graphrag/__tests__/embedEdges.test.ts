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
  embedModelThreshold,
  fetchEmbeddings,
  similarityThreshold,
  similarityWeight,
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

  it('vector cache is keyed by provider + embed model: a settings switch re-embeds everything', async () => {
    // Vectors from different providers/models live in incompatible spaces —
    // reusing them would silently compare across embedding models.
    const calls: string[][] = []
    const embed = scriptedEmbed(calls)

    const g1 = buildDeterministicGraph(FIXTURE_DOC)
    await augmentWithEmbeddingEdges(g1, CONFIG, embed)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toHaveLength(4)

    // Same doc, different provider — zero cache hits, full re-embed.
    const g2 = buildDeterministicGraph(FIXTURE_DOC)
    await augmentWithEmbeddingEdges(g2, { provider: 'openai', apiKey: 'k', model: 'gpt-4o' }, embed)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toHaveLength(4)

    // Same provider, different embed model — also a full re-embed.
    const g3 = buildDeterministicGraph(FIXTURE_DOC)
    await augmentWithEmbeddingEdges(g3, { ...CONFIG, embedModel: 'other-embedder' }, embed)
    expect(calls).toHaveLength(3)
    expect(calls[2]).toHaveLength(4)
  })

  it('mismatched vector dimensions produce NO edge — cosine never truncates to Math.min', async () => {
    const doc = docOf(p('m0', 'first block'), p('m1', 'middle block'), p('m2', 'third block'))
    const graph = buildDeterministicGraph(doc)
    // m0 is 3-dim, m2 is 2-dim; the truncated 2-dim prefix WOULD be a perfect
    // match (cos = 1.0), which is exactly the masking the fix removes.
    const embed: EmbedFn = async (texts) =>
      texts.map((t) =>
        t === 'first block' ? [1, 0, 0] : t === 'third block' ? [1, 0] : [0, 1],
      )
    await augmentWithEmbeddingEdges(graph, CONFIG, embed)
    expect(graph.edges.filter((e) => e.source === 'embedding')).toHaveLength(0)
    expect(graph.embeddingsApplied).toBe(true)
  })
})

describe('augmentWithEmbeddingEdges — block cap (mirror of llmPartial)', () => {
  const mkDoc = (n: number) =>
    docOf(...Array.from({ length: n }, (_, i) => p(`e${i}`, `embed filler ${i}`)))

  it('300 blocks (the boundary): fully embedded, no warn, embeddingsPartial false', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const calls: string[][] = []
      const graph = buildDeterministicGraph(mkDoc(300))
      await augmentWithEmbeddingEdges(graph, CONFIG, scriptedEmbed(calls))
      expect(calls[0]).toHaveLength(300)
      expect(graph.embeddingsPartial).toBe(false)
      expect(graph.embeddingsApplied).toBe(true)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('301 blocks: capped at 300 in doc order, console.warn (blockIds only, no text), embeddingsPartial set', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const calls: string[][] = []
      const graph = buildDeterministicGraph(mkDoc(301))
      await augmentWithEmbeddingEdges(graph, CONFIG, scriptedEmbed(calls))
      expect(calls[0]).toHaveLength(300)
      expect(calls[0][0]).toBe('embed filler 0') // doc order, from the top
      expect(graph.embeddingsPartial).toBe(true)
      expect(graph.embeddingsApplied).toBe(true)
      expect(warn).toHaveBeenCalledTimes(1)
      const msg = String(warn.mock.calls[0][0])
      expect(msg).toContain('1 of 301')
      expect(msg).toContain('[e300]')
      expect(msg).not.toContain('embed filler') // blockIds only — never block text
    } finally {
      warn.mockRestore()
    }
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

  it('200 with vectors → returns them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ vectors: [[1, 0]] }), { status: 200 })),
    )
    expect(await fetchEmbeddings(['x'], CONFIG)).toEqual([[1, 0]])
  })

  it('transient failures THROW so the pass stays unapplied and retries: network, 429, 5xx', async () => {
    // Only a 501 (permanent — provider has no embeddings API) may return
    // null; null marks embeddingsApplied forever, so a transient blip must
    // never take that path.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    await expect(fetchEmbeddings(['x'], CONFIG)).rejects.toThrow('offline')

    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })))
    await expect(fetchEmbeddings(['x'], CONFIG)).rejects.toThrow('429')

    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream boom', { status: 502 })))
    await expect(fetchEmbeddings(['x'], CONFIG)).rejects.toThrow('502')
  })

  it('sends x-embed-model only when config.embedModel is set (UI lands in Wave C)', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ vectors: [[1, 0]] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await fetchEmbeddings(['x'], { ...CONFIG, embedModel: 'nomic-embed-text' })
    const withModel = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect((withModel.headers as Record<string, string>)['x-embed-model']).toBe('nomic-embed-text')

    await fetchEmbeddings(['x'], CONFIG)
    const without = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1]
    expect('x-embed-model' in (without.headers as Record<string, string>)).toBe(false)
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

describe('embedModelThreshold — per-model base threshold', () => {
  it('nomic-embed-text gets the lower, ollama-calibrated threshold', () => {
    expect(embedModelThreshold({ ...CONFIG, embedModel: 'nomic-embed-text' })).toBe(0.78)
  })

  it('any other (or unset) embed model falls back to the text-embedding-3-small default', () => {
    expect(embedModelThreshold(CONFIG)).toBe(0.82) // embedModel unset
    expect(embedModelThreshold({ ...CONFIG, embedModel: 'text-embedding-3-small' })).toBe(0.82)
    expect(embedModelThreshold({ ...CONFIG, embedModel: 'some-other-embedder' })).toBe(0.82)
  })
})

describe('similarityThreshold — adaptive in-document floor', () => {
  it('below 200 pairs: returns the flat per-model threshold regardless of the distribution', () => {
    // Regression guard: this is EXACTLY the shape of the 4-block fixture above
    // (cos(alpha, gamma) = 0.98, only 3 candidate pairs) — if the floor ever
    // engaged below the pair-count guard, a globally-high-similarity SMALL
    // document could suppress a real duplicate. 199 pairs, all at a high
    // similarity that WOULD raise the floor above 0.82 if the guard didn't hold.
    const sims = Array.from({ length: 199 }, () => 0.9)
    expect(similarityThreshold(CONFIG, sims)).toBe(0.82)
    expect(similarityThreshold(CONFIG, [0.98])).toBe(0.82) // the fixture's own shape
  })

  it('at/above 200 pairs with genuine spread: floor tracks mean + 1.5*sd, never below the model threshold', () => {
    // Half the pairs at 0.3 (unrelated), half at 0.5 (mildly related) — a
    // low-similarity document where the floor should NOT rise above the model
    // threshold (max(...) keeps 0.82 as the effective floor).
    const sims = [
      ...Array.from({ length: 100 }, () => 0.3),
      ...Array.from({ length: 100 }, () => 0.5),
    ]
    expect(similarityThreshold(CONFIG, sims)).toBe(0.82)
  })

  it('clamps the adaptive floor to 0.95 even when the document distribution runs hotter', () => {
    // mean ~0.97, sd small but nonzero — mean + 1.5*sd would exceed 0.95
    // unclamped; a near-duplicate must stay reachable rather than requiring
    // near-perfect cosine.
    const sims = Array.from({ length: 250 }, (_, i) => (i % 2 === 0 ? 0.96 : 0.98))
    const threshold = similarityThreshold(CONFIG, sims)
    // mean 0.97, sd 0.01 → mean + 1.5*sd = 0.985, which the clamp must cap at 0.95.
    expect(threshold).toBe(0.95)
  })

  it('a globally-high-similarity document suppresses its own baseline while a genuine duplicate still clears the floor', async () => {
    // Construct N unit vectors with EXACT pairwise cosine = rho for every
    // pair (the "equal correlation" construction: v_i = a*u + b*e_i for
    // orthonormal u, e_1..e_N — cross terms vanish, so v_i . v_j = a^2 for
    // every i != j). rho = 0.85 is comfortably above the flat 0.82 threshold,
    // so a NAIVE flat-threshold pass would link almost every pair in the
    // document — the "everything looks vaguely alike" failure mode the
    // adaptive floor exists to catch. One extra block is an EXACT duplicate
    // of block 0 (cosine 1.0) — a genuine near-duplicate that must still
    // clear the floor even though the whole document sits high.
    const CLUSTER_N = 26 // indices 0..25
    const DIM = CLUSTER_N + 1 // + 1 for the shared component `u`
    const rho = 0.85
    const a = Math.sqrt(rho)
    const b = Math.sqrt(1 - rho)
    const vecFor = (i: number): number[] => {
      const v = new Array(DIM).fill(0)
      v[0] = a // shared `u` component (dimension 0)
      v[i + 1] = b // idiosyncratic component (dimensions 1..CLUSTER_N)
      return v
    }
    const vectors: number[][] = Array.from({ length: CLUSTER_N }, (_, i) => vecFor(i))
    vectors.push(vecFor(0)) // block CLUSTER_N: an exact duplicate of block 0

    const blocks = vectors.map((_, i) => p(`c${i}`, `cluster filler paragraph ${i}`))
    const doc = docOf(...blocks)
    const graph = buildDeterministicGraph(doc)
    const embed: EmbedFn = async (texts) => texts.map((_, idx) => vectors[idx])
    await augmentWithEmbeddingEdges(graph, CONFIG, embed)

    const embEdges = graph.edges.filter((e) => e.source === 'embedding')
    // The genuine duplicate (block 0 <-> the last block) must be linked.
    expect(
      embEdges.some(
        (e) =>
          (e.from === 'c0' && e.to === `c${CLUSTER_N}`) ||
          (e.from === `c${CLUSTER_N}` && e.to === 'c0'),
      ),
    ).toBe(true)
    // A naive flat 0.82 threshold would have linked nearly every one of the
    // ~300 cluster-internal pairs (all sitting at cosine 0.85). The adaptive
    // floor must suppress the vast majority of them.
    expect(embEdges.length).toBeLessThan(5)
  })
})

describe('similarityWeight — monotonic in cosine', () => {
  it('is non-decreasing as cosine rises above the floor', () => {
    const floor = 0.8
    const sims = [0.8, 0.85, 0.9, 0.95, 0.99, 1.0]
    const weights = sims.map((s) => similarityWeight(s, floor))
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]).toBeGreaterThanOrEqual(weights[i - 1])
    }
  })

  it('is barely-justified (0.5) right at the floor, and clamped to at most 0.95', () => {
    const floor = 0.8
    expect(similarityWeight(floor, floor)).toBeCloseTo(0.5, 5)
    expect(similarityWeight(1, floor)).toBeLessThanOrEqual(0.95)
    expect(similarityWeight(1, floor)).toBeCloseTo(0.95, 5) // 0.5 + 0.2*2.5 = 1.0, clamped to 0.95
  })

  it('never drops below 0.5 even if called with a cosine below the floor', () => {
    expect(similarityWeight(0.5, 0.8)).toBe(0.5)
  })
})

describe('augmentWithEmbeddingEdges — edges carry a similarity kind and monotonic weight', () => {
  it('tags embedding edges with kind: similarity and a weight derived from cosine', async () => {
    const graph = buildDeterministicGraph(FIXTURE_DOC)
    await augmentWithEmbeddingEdges(graph, CONFIG, scriptedEmbed())
    const embEdges = graph.edges.filter((e) => e.source === 'embedding')
    expect(embEdges).toHaveLength(1)
    expect(embEdges[0].kind).toBe('similarity')
    expect(typeof embEdges[0].weight).toBe('number')
    expect(embEdges[0].weight).toBeGreaterThanOrEqual(0.5)
    expect(embEdges[0].weight).toBeLessThanOrEqual(0.95)
  })
})
