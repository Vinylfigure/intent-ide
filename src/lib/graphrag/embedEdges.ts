import type { LLMConfig } from '@/stores/settingsStore'
import { addEstimate } from '@/lib/ai/spendEstimate'
import type { DocGraph, DocGraphEdge } from './docGraph'

/**
 * Embedding edge source — paraphrase recall the extractors and the link_blocks
 * pass both miss. Every textblock is embedded (one batched call, vectors
 * cached by per-block content hash), and NON-adjacent block pairs above a
 * cosine-similarity threshold gain a `duplicates` edge with source
 * 'embedding'. Graph-adjacent pairs and doc-adjacent neighbors are skipped:
 * the former are already connected, the latter are trivially related prose.
 *
 * Failure contract: a PERMANENTLY unsupported provider (Anthropic has no
 * embeddings API — /api/embed answers 501) degrades to fewer edges with no
 * retry loop; TRANSIENT failures (network, 429, 5xx) throw out of the embed
 * fn, augmentWithEmbeddingEdges swallows them and leaves the pass unapplied
 * so the next cascade retries. Never an error thrown into the cascade.
 */

/**
 * null = embeddings PERMANENTLY unsupported for this provider (no retry).
 * Transient failures must THROW so the pass stays unapplied and is retried.
 */
export type EmbedFn = (texts: string[], config: LLMConfig) => Promise<number[][] | null>

// NOTE: uncalibrated across embedding models — 0.82 was picked against
// text-embedding-3-small-style cosine distributions, and different models
// (or dimensions) shift the similarity range. If a swapped embed model over-
// or under-links paraphrases, this constant is where to tune.
const SIMILARITY_THRESHOLD = 0.82

// Cap on the embedding pass: only the first EMBED_MAX_BLOCKS blocks in doc
// order are embedded. Beyond it the graph is marked embeddingsPartial and
// warns (mirror of llmPartial) — never a silent truncation.
const EMBED_MAX_BLOCKS = 300

// Module-level vector cache keyed by provider + embed model + per-block
// content hash — an incremental rebuild only embeds blocks whose text
// actually changed, and switching provider/model never reuses foreign
// vectors (which would silently compare across incompatible spaces).
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
 * convention as /api/structured, plus x-embed-model when configured). Only a
 * 501 (provider PERMANENTLY has no embeddings API — the claude case) returns
 * null, which the caller treats as a silent no-op with no retry. Everything
 * transient — network errors, 429, 5xx — THROWS, so augmentWithEmbeddingEdges
 * leaves embeddingsApplied false and the next cascade retries.
 */
export const fetchEmbeddings: EmbedFn = async (texts, config) => {
  // Soft spend indicator (display only).
  addEstimate(texts.reduce((n, t) => n + t.length, 0))
  const res = await fetch('/api/embed', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'x-provider': config.provider,
      'x-model': config.model,
      ...(config.baseUrl ? { 'x-base-url': config.baseUrl } : {}),
      ...(config.embedModel ? { 'x-embed-model': config.embedModel } : {}),
    },
    body: JSON.stringify({ texts }),
  })
  if (res.status === 501) return null // permanent: provider has no embeddings API
  if (!res.ok) throw new Error(`embed request failed: ${res.status}`) // transient: retried
  const data = await res.json()
  return Array.isArray(data.vectors) ? (data.vectors as number[][]) : null
}

/**
 * Cosine similarity. A dimension mismatch (vectors from different embedding
 * models sharing the cache window) returns 0 — never Math.min truncation,
 * which would silently compare incompatible spaces.
 */
function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  const len = a.length
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
 * Mutates `graph` in place: embeds the first EMBED_MAX_BLOCKS textblocks in
 * doc order (cache-aware, one batched call for the misses; beyond the cap the
 * graph is marked embeddingsPartial and warns) and adds `duplicates` edges
 * between non-adjacent pairs above the similarity threshold. A null embed
 * result (provider permanently unsupported) marks the pass applied with zero
 * edges; a thrown embed (transient failure) is swallowed and left unapplied
 * for a later retry. Never throws.
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

  const orderedAll = [...graph.nodes.values()].sort((a, b) => a.pos - b.pos)
  const ordered = orderedAll.slice(0, EMBED_MAX_BLOCKS)
  if (orderedAll.length > EMBED_MAX_BLOCKS) {
    const skipped = orderedAll.slice(EMBED_MAX_BLOCKS)
    graph.embeddingsPartial = true
    console.warn(
      `docGraph: embedding pass block cap hit — ${skipped.length} of ${orderedAll.length} blocks ` +
        `(from [${skipped[0].blockId}] onward) were not embedded; graph marked embeddingsPartial`,
    )
  }
  // Vectors from different providers/models live in incompatible spaces —
  // key the cache by both so a settings switch re-embeds instead of reusing.
  const hashOf = (blockId: string) =>
    `${config.provider}:${config.embedModel ?? 'default'}:${graph.blockHashes.get(blockId) ?? blockId}`

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
