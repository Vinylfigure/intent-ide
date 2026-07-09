import type { LLMConfig } from '@/stores/settingsStore'
import type { DocGraph, DocGraphEdge } from './docGraph'

/**
 * Embedding edge source — paraphrase recall the extractors and the link_blocks
 * pass both miss. Every textblock is embedded (one batched call, vectors
 * cached by per-block content hash), and NON-adjacent block pairs above a
 * cosine-similarity threshold gain a `duplicates` edge with source
 * 'embedding'. Graph-adjacent pairs and doc-adjacent neighbors are skipped:
 * the former are already connected, the latter are trivially related prose.
 *
 * Same failure-swallowing contract as the LLM pass: unsupported providers
 * (Anthropic has no embeddings API) and any failure degrade to fewer edges —
 * never an error thrown into the cascade.
 */

/** null = embeddings unsupported for this provider, or the call failed. */
export type EmbedFn = (texts: string[], config: LLMConfig) => Promise<number[][] | null>

const SIMILARITY_THRESHOLD = 0.82

// Module-level vector cache keyed by per-block content hash — an incremental
// rebuild only embeds blocks whose text actually changed.
const VECTOR_CACHE_MAX = 500
const vectorCache = new Map<string, number[]>()

function cacheVector(hash: string, vector: number[]): void {
  vectorCache.delete(hash)
  vectorCache.set(hash, vector)
  while (vectorCache.size > VECTOR_CACHE_MAX) {
    const oldest = vectorCache.keys().next().value
    if (oldest === undefined) break
    vectorCache.delete(oldest)
  }
}

/** Test hygiene: clear the module-level vector cache. */
export function clearEmbeddingVectorCache(): void {
  vectorCache.clear()
}

/**
 * Default EmbedFn: the provider-agnostic /api/embed route (same header
 * convention as /api/structured). A 501 (provider has no embeddings API) and
 * every other failure return null — the caller treats it as a silent no-op.
 */
export const fetchEmbeddings: EmbedFn = async (texts, config) => {
  try {
    const res = await fetch('/api/embed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'x-provider': config.provider,
        'x-model': config.model,
        ...(config.baseUrl ? { 'x-base-url': config.baseUrl } : {}),
      },
      body: JSON.stringify({ texts }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return Array.isArray(data.vectors) ? (data.vectors as number[][]) : null
  } catch {
    return null
  }
}

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / Math.sqrt(normA * normB)
}

function isGraphAdjacent(graph: DocGraph, a: string, b: string): boolean {
  return (graph.adjacency.get(a) ?? []).some((e) => e.from === b || e.to === b)
}

/**
 * Mutates `graph` in place: embeds all textblocks (cache-aware, one batched
 * call for the misses) and adds `duplicates` edges between non-adjacent pairs
 * above the similarity threshold. A null embed result (unsupported/failed
 * transport) marks the pass applied with zero edges; a thrown scripted embed
 * is swallowed and left unapplied for a later retry. Never throws.
 */
export async function augmentWithEmbeddingEdges(
  graph: DocGraph,
  config: LLMConfig,
  embed: EmbedFn = fetchEmbeddings,
): Promise<void> {
  if (graph.embeddingsApplied) return
  if (graph.nodes.size === 0) {
    graph.embeddingsApplied = true
    return
  }

  const ordered = [...graph.nodes.values()].sort((a, b) => a.pos - b.pos)
  const hashOf = (blockId: string) => graph.blockHashes.get(blockId) ?? blockId

  const missing = ordered.filter((n) => !vectorCache.has(hashOf(n.blockId)))
  if (missing.length > 0) {
    let vectors: number[][] | null
    try {
      vectors = await embed(missing.map((n) => n.text), config)
    } catch {
      return // transport blew up — leave unapplied so a later build retries
    }
    if (!vectors || vectors.length !== missing.length) {
      // Unsupported provider or malformed response — silent no-op, no retry loop.
      graph.embeddingsApplied = true
      return
    }
    missing.forEach((n, i) => cacheVector(hashOf(n.blockId), vectors[i]))
  }

  const vecs = ordered.map((n) => vectorCache.get(hashOf(n.blockId)))
  const added: DocGraphEdge[] = []
  for (let i = 0; i < ordered.length; i++) {
    const va = vecs[i]
    if (!va) continue
    for (let j = i + 1; j < ordered.length; j++) {
      if (j === i + 1) continue // doc-adjacent neighbors — trivially related
      const vb = vecs[j]
      if (!vb) continue
      if (isGraphAdjacent(graph, ordered[i].blockId, ordered[j].blockId)) continue
      const sim = cosine(va, vb)
      if (sim <= SIMILARITY_THRESHOLD) continue
      added.push({
        from: ordered[i].blockId,
        to: ordered[j].blockId,
        type: 'duplicates',
        source: 'embedding',
        evidence: `semantic similarity ${sim.toFixed(2)}`,
      })
    }
  }

  if (added.length > 0) {
    graph.edges.push(...added)
    const push = (id: string, edge: DocGraphEdge) => {
      const list = graph.adjacency.get(id)
      if (list) list.push(edge)
      else graph.adjacency.set(id, [edge])
    }
    for (const edge of added) {
      push(edge.from, edge)
      push(edge.to, edge)
    }
  }
  graph.embeddingsApplied = true
}
