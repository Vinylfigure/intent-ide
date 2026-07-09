import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import type { LLMConfig } from '@/stores/settingsStore'
import type { CascadeEdgeType } from '@/lib/annotations/types'
import { collectTextblocks } from '@/lib/prosemirror/blockIds'
import { fetchStructured, type CallStructuredFn } from '@/lib/ai/structuredClient'
import { augmentWithEmbeddingEdges, type EmbedFn } from './embedEdges'
import {
  searchNodes as graphitiSearchNodes,
  getSubgraph as graphitiGetSubgraph,
  type GraphNode as GraphitiNode,
  type SubgraphResult as GraphitiSubgraph,
} from '@/lib/mcp/graphitiClient'

/**
 * Document dependency graph — the retrieval index the cascade queries instead
 * of the raw document text. Nodes are textblocks keyed by stable blockId;
 * edges are typed relations from deterministic extractors (cross-references,
 * defined terms, duplicated sentences) plus a cached, chunked LLM extraction
 * pass that updates incrementally: per-block hashes diff each build against
 * the closest prior graph so only changed blocks (and their neighbors) are
 * re-extracted.
 *
 * Positions stored on nodes are build-time snapshots for ordering only — every
 * consumer re-resolves blocks against the live doc via findBlockById.
 */

export interface DocGraphNode {
  blockId: string
  /** Build-time snapshot; never consumed for edits. */
  pos: number
  nodeType: string
  text: string
  /** Enclosing heading texts, outermost first — prompt context. */
  headingPath: string[]
  definedTerms: string[]
}

export type DocGraphEdgeSource = 'deterministic' | 'llm' | 'embedding' | 'graphiti'

/**
 * Precision ranking of edge sources — lower is higher-precision. Used to
 * stable-sort adjacency walks (findEdgePath evidence selection) and to rank
 * cascade candidates discovered at the same hop (orchestrator ordering).
 */
export const SOURCE_PRIORITY: Record<DocGraphEdgeSource, number> = {
  deterministic: 0,
  llm: 1,
  embedding: 2,
  graphiti: 3,
}

export interface DocGraphEdge {
  from: string
  to: string
  type: CascadeEdgeType
  source: DocGraphEdgeSource
  /** Matched term or verified verbatim quote that produced this edge. */
  evidence?: string
}

export interface DocGraph {
  contentHash: string
  builtAt: number
  /** True once the LLM extraction pass ran and its edges were merged. */
  llmApplied: boolean
  /**
   * True when the LLM pass could not cover every block (chunk cap hit, or an
   * incomplete prior pass carried forward) — the graph is still usable, just
   * with known-reduced recall. Never a silent truncation: setting this warns.
   */
  llmPartial: boolean
  /**
   * True once the embedding pass ran — including the silent no-op case where
   * the provider has no embeddings API (fewer edges, no retry loop).
   */
  embeddingsApplied: boolean
  /**
   * True when the embedding pass could not cover every block (block cap hit)
   * — mirror of llmPartial. Never a silent truncation: setting this warns.
   */
  embeddingsPartial: boolean
  /**
   * True once the Graphiti entity pass ran to completion. Stays false on any
   * MCP failure/timeout (FalkorDB is usually down in dev) — the pass is
   * best-effort, but a cached fully-built graph is never invalidated just
   * because Graphiti was unreachable. Note the retry boundary: a warm-cache
   * rebuild of the SAME content hash short-circuits before the Graphiti pass,
   * so a failed pass is only retried when the content hash changes (a new
   * build) — never on warm-cache hits.
   */
  graphitiApplied: boolean
  /** Per-textblock FNV-1a over blockId + text — the incremental-diff unit. */
  blockHashes: Map<string, string>
  nodes: Map<string, DocGraphNode>
  edges: DocGraphEdge[]
  /** Undirected index: blockId → edges touching it. */
  adjacency: Map<string, DocGraphEdge[]>
}

const EDGE_TYPES: ReadonlySet<string> = new Set([
  'defines',
  'references',
  'depends-on',
  'implements',
  'tests',
  'contradicts',
  'duplicates',
])

// LLM pass sizing. Docs up to LLM_SINGLE_CALL_MAX blocks (the core 5–20-page
// use case) go to the model in ONE whole-doc call so every pair of blocks is
// co-visible — chunking would make pairs more than ~LLM_CHUNK_SIZE blocks
// apart structurally unlinkable. Only ABOVE 150 blocks does the pass fall
// back to contiguous ≤40-block chunks with a 4-block overlap between
// consecutive chunks (cheap cross-boundary stitching — validation already
// drops edges citing ids outside the graph), capped at 8 calls per build.
// Beyond the cap the graph is marked llmPartial and warns — never a silent
// truncation.
const LLM_SINGLE_CALL_MAX = 150
const LLM_CHUNK_SIZE = 40
const LLM_CHUNK_OVERLAP = 4
const LLM_MAX_CHUNKS = 8

const TERM_STOPWORDS = new Set([
  'the', 'this', 'that', 'these', 'those', 'with', 'from', 'have', 'been',
  'will', 'shall', 'must', 'may', 'and', 'for', 'not', 'are', 'was', 'were',
  'section', 'sections', 'document', 'page',
])

// --- Content hash -----------------------------------------------------------

/** Sync FNV-1a over blockId + text per textblock — stable cache key. */
export function contentHash(doc: PMNode): string {
  let h = 0x811c9dc5
  const update = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
  }
  for (const b of collectTextblocks(doc)) {
    update(b.blockId ?? '')
    update('\u0001')
    update(b.node.textContent)
    update('\u0002')
  }
  return h.toString(36)
}

/** FNV-1a over one block's id + text — the per-block incremental-diff unit. */
export function blockHash(blockId: string, text: string): string {
  let h = 0x811c9dc5
  const update = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
  }
  update(blockId)
  update('\u0001')
  update(text)
  return h.toString(36)
}

// --- Deterministic build ----------------------------------------------------

const DEFINITION_PATTERNS = [
  // "Term" means / refers to / is defined as ...
  /^["“”']?([A-Z][\w -]{2,40}?)["“”']?\s+(?:means|refers to|is defined as)\b/,
  // ... (the "Term")
  /\(the\s+["“']([\w -]{2,40}?)["”']\)/,
]

function extractDefinedTerms(node: PMNode): string[] {
  const terms: string[] = []
  const text = node.textContent
  for (const pattern of DEFINITION_PATTERNS) {
    const m = text.match(pattern)
    if (m?.[1]) terms.push(m[1].trim())
  }
  // Leading strong-marked phrase followed by ':' or '—' (glossary style)
  const first = node.firstChild
  if (first?.isText && first.text && first.marks.some((mk) => mk.type.name === 'strong')) {
    const term = first.text.replace(/[:——-]\s*$/, '').trim()
    const rest = text.slice(first.text.length)
    if (
      (first.text.trim().endsWith(':') || /^\s*[:——]/.test(rest)) &&
      term.length >= 3 &&
      term.length <= 40
    ) {
      terms.push(term)
    }
  }
  return terms.filter(
    (t) => t.length >= 3 && !TERM_STOPWORDS.has(t.toLowerCase()),
  )
}

/** Word-boundary, case-insensitive containment (mirrors cascadeCheck's matcher). */
export function containsTerm(text: string, term: string): boolean {
  const lowerText = text.toLowerCase()
  const lowerTerm = term.toLowerCase()
  let start = 0
  while (start < lowerText.length) {
    const idx = lowerText.indexOf(lowerTerm, start)
    if (idx === -1) return false
    const before = idx > 0 ? lowerText[idx - 1] : ' '
    const after =
      idx + lowerTerm.length < lowerText.length ? lowerText[idx + lowerTerm.length] : ' '
    if (/\W/.test(before) && /\W/.test(after)) return true
    start = idx + 1
  }
  return false
}

function normalizeHeading(text: string): string {
  return text.toLowerCase().replace(/[^\w ]/g, '').replace(/\s+/g, ' ').trim()
}

const SECTION_NUMBER_RE = /\bsections?\s+(\d+)(?:\.\d+)*/gi
// Quoted form ends at the closing quote; bare form must start capitalized and
// run to punctuation/EOL (keeps "under the hood"-style prose from matching).
const NAMED_REF_RE =
  /\b(?:see(?:\s+also)?|refer\s+to|per|under|as\s+(?:defined|described|discussed|noted)\s+(?:in|under))\s+(?:the\s+)?(?:section\s+)?(?:["“']([^"“”'\n]{3,60})["”']|([A-Z][\w /&-]{2,60}?)(?=$|[.,;:)\n]))/g

export function buildDeterministicGraph(doc: PMNode): DocGraph {
  const blocks = collectTextblocks(doc)
  const nodes = new Map<string, DocGraphNode>()
  const edges: DocGraphEdge[] = []
  const edgeKeys = new Set<string>()

  const addEdge = (edge: DocGraphEdge) => {
    if (edge.from === edge.to) return
    const key = `${edge.from}${edge.to}${edge.type}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push(edge)
  }

  // Pass 1: nodes, heading paths, defined terms, heading indexes
  const headingStack: Array<{ level: number; text: string }> = []
  const headingByNorm = new Map<string, string>()
  const headingsInOrder: Array<{ blockId: string; text: string }> = []
  const blockHashes = new Map<string, string>()

  for (const b of blocks) {
    if (!b.blockId) continue
    const text = b.node.textContent
    blockHashes.set(b.blockId, blockHash(b.blockId, text))
    if (b.node.type.name === 'heading') {
      const level = (b.node.attrs.level as number) ?? 1
      while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop()
      }
      headingStack.push({ level, text })
      headingByNorm.set(normalizeHeading(text), b.blockId)
      headingsInOrder.push({ blockId: b.blockId, text })
    }
    nodes.set(b.blockId, {
      blockId: b.blockId,
      pos: b.pos,
      nodeType: b.node.type.name,
      text,
      headingPath: headingStack
        .slice(0, b.node.type.name === 'heading' ? -1 : undefined)
        .map((h) => h.text),
      definedTerms: extractDefinedTerms(b.node),
    })
  }

  // Pass 2a: explicit cross-references → `references` edges to headings
  for (const node of nodes.values()) {
    for (const m of node.text.matchAll(SECTION_NUMBER_RE)) {
      const idx = parseInt(m[1], 10) - 1
      const target = headingsInOrder[idx]
      if (target) {
        addEdge({
          from: node.blockId,
          to: target.blockId,
          type: 'references',
          source: 'deterministic',
          evidence: m[0],
        })
      }
    }
    for (const m of node.text.matchAll(NAMED_REF_RE)) {
      const target = headingByNorm.get(normalizeHeading(m[1] ?? m[2]))
      if (target) {
        addEdge({
          from: node.blockId,
          to: target,
          type: 'references',
          source: 'deterministic',
          evidence: m[0],
        })
      }
    }
  }

  // Pass 2b: shared defined terms → `references` edges to the defining block
  for (const definer of nodes.values()) {
    for (const term of definer.definedTerms) {
      for (const other of nodes.values()) {
        if (other.blockId === definer.blockId) continue
        if (containsTerm(other.text, term)) {
          addEdge({
            from: other.blockId,
            to: definer.blockId,
            type: 'references',
            source: 'deterministic',
            evidence: term,
          })
        }
      }
    }
  }

  // Pass 2c: duplicated sentences → `duplicates` edges
  const sentenceOwner = new Map<string, string>()
  for (const node of nodes.values()) {
    const sentences = node.text.split(/(?<=[.!?])\s+/)
    for (const raw of sentences) {
      const norm = raw.toLowerCase().replace(/\s+/g, ' ').trim()
      if (norm.length < 40) continue
      const owner = sentenceOwner.get(norm)
      if (owner && owner !== node.blockId) {
        addEdge({
          from: node.blockId,
          to: owner,
          type: 'duplicates',
          source: 'deterministic',
          evidence: raw.trim(),
        })
      } else if (!owner) {
        sentenceOwner.set(norm, node.blockId)
      }
    }
  }

  return {
    contentHash: contentHash(doc),
    builtAt: Date.now(),
    llmApplied: false,
    llmPartial: false,
    embeddingsApplied: false,
    embeddingsPartial: false,
    graphitiApplied: false,
    blockHashes,
    nodes,
    edges,
    adjacency: buildAdjacency(edges),
  }
}

function buildAdjacency(edges: DocGraphEdge[]): Map<string, DocGraphEdge[]> {
  const adjacency = new Map<string, DocGraphEdge[]>()
  const push = (id: string, edge: DocGraphEdge) => {
    const list = adjacency.get(id)
    if (list) list.push(edge)
    else adjacency.set(id, [edge])
  }
  for (const edge of edges) {
    push(edge.from, edge)
    push(edge.to, edge)
  }
  return adjacency
}

// --- LLM extraction pass ----------------------------------------------------

const LINK_BLOCKS_TOOL = {
  name: 'link_blocks',
  description:
    'Declare one directed semantic relationship between two blocks of the document. Call once per high-confidence link only — precision over recall. Do not restate links that are obvious from shared wording alone.',
  input_schema: {
    type: 'object',
    properties: {
      from_block_id: { type: 'string', description: 'Id of the block that depends on / refers to the other.' },
      to_block_id: { type: 'string', description: 'Id of the block being depended on / referred to.' },
      edge_type: {
        type: 'string',
        enum: ['defines', 'references', 'depends-on', 'implements', 'tests', 'contradicts', 'duplicates'],
      },
      quoted_text: {
        type: 'string',
        description: 'Verbatim phrase from the FROM block that evidences the link.',
      },
    },
    required: ['from_block_id', 'to_block_id', 'edge_type'],
  },
}

const LINK_SYSTEM =
  'You map semantic dependencies inside a document. Each block is listed as [blockId] text. Call link_blocks once per real dependency between two blocks — a claim relying on another, a term used where another block defines it, duplicated or contradicting statements. Only link blocks that would need to change together. If unsure, do not link.'

interface LinkBlocksInput {
  from_block_id?: string
  to_block_id?: string
  edge_type?: string
  quoted_text?: string
}

/** True when the provider can be called at all (Ollama needs no key). */
function llmAvailable(config: LLMConfig): boolean {
  return config.provider === 'ollama' || Boolean(config.apiKey)
}

/**
 * Listings for the extraction pass. At or under LLM_SINGLE_CALL_MAX blocks:
 * ONE whole-doc listing (every pair co-visible). Above it: contiguous
 * ≤LLM_CHUNK_SIZE chunks, consecutive chunks sharing LLM_CHUNK_OVERLAP
 * blocks, hard-capped at LLM_MAX_CHUNKS. `skipped` counts trailing blocks
 * beyond the cap that no chunk covers.
 */
function chunkNodes(ordered: DocGraphNode[]): { chunks: DocGraphNode[][]; skipped: number } {
  if (ordered.length <= LLM_SINGLE_CALL_MAX) {
    return { chunks: [ordered], skipped: 0 }
  }
  const chunks: DocGraphNode[][] = []
  const stride = LLM_CHUNK_SIZE - LLM_CHUNK_OVERLAP
  let covered = 0
  for (let start = 0; start < ordered.length && chunks.length < LLM_MAX_CHUNKS; start += stride) {
    chunks.push(ordered.slice(start, start + LLM_CHUNK_SIZE))
    covered = Math.min(ordered.length, start + LLM_CHUNK_SIZE)
    if (covered >= ordered.length) break
  }
  return { chunks, skipped: ordered.length - covered }
}

/**
 * Chunked extraction over the graph — or, when `targetIds` is given, only that
 * changed-neighborhood subset (the incremental path). Mutates `graph` in
 * place: validated LLM edges are merged and `llmApplied` flips true; blocks
 * left uncovered by the chunk cap set `llmPartial` and warn — no silent
 * truncation. Chunk calls run in parallel (fetchWithRetry inside the call fn
 * already handles per-call retry); any chunk failure keeps the successful
 * chunks' edges but leaves `llmApplied` false so the next build retries (the
 * edge-key dedupe absorbs the re-reported edges) — never throws.
 */
export async function augmentWithLlmEdges(
  graph: DocGraph,
  config: LLMConfig,
  call: CallStructuredFn = fetchStructured,
  targetIds?: ReadonlySet<string>,
): Promise<void> {
  if (graph.llmApplied) return
  if (graph.nodes.size === 0) return
  if (!llmAvailable(config)) return

  const ordered = [...graph.nodes.values()]
    .filter((n) => !targetIds || targetIds.has(n.blockId))
    .sort((a, b) => a.pos - b.pos)
  if (ordered.length === 0) {
    // Incremental build where every change was a deletion — nothing to extract.
    graph.llmApplied = true
    return
  }

  const { chunks, skipped } = chunkNodes(ordered)
  if (skipped > 0) {
    graph.llmPartial = true
    console.warn(
      `docGraph: LLM extraction chunk cap hit — ${skipped} of ${ordered.length} blocks ` +
        `(from [${ordered[ordered.length - skipped].blockId}] onward) were not analyzed; ` +
        'graph marked llmPartial',
    )
  }

  // Chunk calls are independent listings — run them in parallel (the call fn
  // handles per-call retry internally).
  const results = await Promise.allSettled(
    chunks.map((chunk) => {
      const listing = chunk.map((n) => `[${n.blockId}] ${n.text}`).join('\n')
      return call(
        {
          messages: [
            { role: 'system', content: LINK_SYSTEM },
            { role: 'user', content: `DOCUMENT BLOCKS:\n${listing}` },
          ],
          tools: [LINK_BLOCKS_TOOL],
          maxTokens: 2000,
          temperature: 0.1,
        },
        // Edge extraction is the cascade's RECALL mechanism — paraphrase
        // dependencies only surface if this pass finds them, so it runs on the
        // user's selected model, never a silent cheap-model downgrade.
        config,
      )
    }),
  )

  const allToolCalls: { name: string; input: unknown }[] = []
  let anyFailed = false
  for (const res of results) {
    if (res.status === 'fulfilled') allToolCalls.push(...res.value.toolCalls)
    else anyFailed = true
  }

  // Merge what the successful chunks found; a failed chunk leaves llmApplied
  // false so the next getDocGraph retries (the edge-key dedupe absorbs the
  // re-reported edges).
  mergeLlmToolCalls(graph, allToolCalls)
  if (!anyFailed) graph.llmApplied = true
}

/** Validate + dedupe link_blocks calls into the graph, rebuilding adjacency. */
function mergeLlmToolCalls(
  graph: DocGraph,
  toolCalls: { name: string; input: unknown }[],
): void {
  const edgeKeys = new Set(graph.edges.map((e) => `${e.from}${e.to}${e.type}`))
  for (const tc of toolCalls) {
    if (tc.name !== 'link_blocks') continue
    const input = tc.input as LinkBlocksInput
    const from = input?.from_block_id
    const to = input?.to_block_id
    const type = input?.edge_type
    if (!from || !to || from === to) continue
    if (!graph.nodes.has(from) || !graph.nodes.has(to)) continue
    if (!type || !EDGE_TYPES.has(type)) continue
    const key = `${from}${to}${type}`
    if (edgeKeys.has(key)) continue
    edgeKeys.add(key)
    // Keep the edge but only credit evidence that verifies verbatim.
    const quoted = input.quoted_text
    const verified = quoted && graph.nodes.get(from)!.text.includes(quoted)
    graph.edges.push({
      from,
      to,
      type: type as CascadeEdgeType,
      source: 'llm',
      ...(verified ? { evidence: quoted } : {}),
    })
  }
  graph.adjacency = buildAdjacency(graph.edges)
}

// --- Graphiti entity pass -----------------------------------------------------

// Same call shape as the old read-only cascade lane (searchNodes → top-3
// subgraphs), but the results become GRAPH EDGES the one cascade surface
// consumes — not a parallel decoration surface. Tight caps on purpose: the
// old lane's known failure mode was a false-positive firehose from generic
// entity names matched all over the document.
const GRAPHITI_TIMEOUT_MS = 1500
const GRAPHITI_QUERY_MAX_CHARS = 200
const GRAPHITI_SEARCH_LIMIT = 5
const GRAPHITI_SUBGRAPH_CAP = 3
const GRAPHITI_MAX_BLOCKS_PER_ENTITY = 10
const GRAPHITI_MIN_ENTITY_LENGTH = 4
// Right-axis bounds: caps per-ENTITY above bound the left axis (blocks per
// entity), these bound how many entities and how many total edges one build
// may ever produce — a chatty knowledge graph cannot firehose the doc graph.
const GRAPHITI_MAX_ENTITIES_PER_BUILD = 12
const GRAPHITI_MAX_EDGES_PER_BUILD = 120

export interface GraphitiEdgeDeps {
  searchNodes?: (query: string, limit?: number, signal?: AbortSignal) => Promise<GraphitiNode[]>
  getSubgraph?: (nodeId: string, radius?: number, signal?: AbortSignal) => Promise<GraphitiSubgraph>
  timeoutMs?: number
}

/**
 * Run abortable work against a deadline. The deadline both rejects the race
 * AND aborts the signal handed to `work`, so in-flight fetches are cancelled
 * and any sequential follow-up calls stop — no zombie MCP conversation
 * outliving the race. The timer never outlives the race.
 */
async function withDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new Error('graphiti timeout'))
      reject(new Error('graphiti timeout'))
    }, ms)
  })
  try {
    return await Promise.race([work(controller.signal), deadline])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Third edge source: knowledge-graph entities from the Graphiti MCP server.
 * Searches the graph for entities related to this document, then links every
 * pair of blocks that BOTH mention an entity name (word-boundary match via
 * containsTerm) with a `references`/`graphiti` edge carrying the entity name
 * as evidence.
 *
 * Guardrails (the old read-only lane's false-positive lessons):
 * - entities shorter than GRAPHITI_MIN_ENTITY_LENGTH chars or matching the
 *   term stopwords are skipped entirely;
 * - at most GRAPHITI_MAX_ENTITIES_PER_BUILD valid entities are processed per
 *   build (first-appearance order); hitting the cap logs a count-only warn;
 * - an entity mentioned in more than GRAPHITI_MAX_BLOCKS_PER_ENTITY blocks is
 *   capped to its first N blocks in document order (no pairwise firehose);
 * - at most GRAPHITI_MAX_EDGES_PER_BUILD graphiti edges are added per build;
 *   hitting the cap logs a count-only warn;
 * - entities found in fewer than 2 distinct blocks produce nothing;
 * - dedupe is direction-agnostic: a graphiti pair whose reverse orientation
 *   already exists as a deterministic/llm 'references' edge adds nothing.
 *
 * Strictly best-effort and non-blocking: the whole MCP conversation races a
 * GRAPHITI_TIMEOUT_MS deadline that also ABORTS the in-flight MCP calls (the
 * AbortSignal is threaded through searchNodes/getSubgraph, and the sequential
 * subgraph loop stops between calls once aborted), and ANY failure (FalkorDB
 * down — the usual dev state) returns silently having changed nothing.
 */
export async function augmentWithGraphitiEdges(
  graph: DocGraph,
  deps: GraphitiEdgeDeps = {},
): Promise<void> {
  if (graph.graphitiApplied) return
  if (graph.nodes.size < 2) {
    graph.graphitiApplied = true
    return
  }
  const search = deps.searchNodes ?? graphitiSearchNodes
  const subgraph = deps.getSubgraph ?? graphitiGetSubgraph
  const timeoutMs = deps.timeoutMs ?? GRAPHITI_TIMEOUT_MS

  try {
    const entityNames = await withDeadline(
      async (signal) => {
        const ordered = [...graph.nodes.values()].sort((a, b) => a.pos - b.pos)
        const query = ordered
          .map((n) => n.text)
          .join(' ')
          .slice(0, GRAPHITI_QUERY_MAX_CHARS)
        const matching = await search(query, GRAPHITI_SEARCH_LIMIT, signal)
        const names = new Set<string>()
        for (const node of matching.slice(0, GRAPHITI_SUBGRAPH_CAP)) {
          // The deadline may already have fired — never start a zombie call.
          if (signal.aborted) throw new Error('graphiti timeout')
          names.add(node.name)
          const sub = await subgraph(node.uuid, 2, signal)
          for (const gn of sub.nodes) names.add(gn.name)
        }
        return names
      },
      timeoutMs,
    )

    const ordered = [...graph.nodes.values()].sort((a, b) => a.pos - b.pos)
    const edgeKeys = new Set(graph.edges.map((e) => `${e.from} ${e.to} ${e.type}`))
    let added = false
    let processedEntities = 0
    let addedEdges = 0
    let entityCapHit = false
    let edgeCapHit = false
    for (const rawName of entityNames) {
      const name = rawName?.trim()
      if (!name || name.length < GRAPHITI_MIN_ENTITY_LENGTH) continue
      if (TERM_STOPWORDS.has(name.toLowerCase())) continue
      if (processedEntities >= GRAPHITI_MAX_ENTITIES_PER_BUILD) {
        entityCapHit = true
        break
      }
      processedEntities++
      const containing = ordered
        .filter((n) => containsTerm(n.text, name))
        .slice(0, GRAPHITI_MAX_BLOCKS_PER_ENTITY)
      if (containing.length < 2) continue
      outer: for (let i = 0; i < containing.length; i++) {
        for (let j = i + 1; j < containing.length; j++) {
          const from = containing[i].blockId
          const to = containing[j].blockId
          // Direction-normalized dedupe: check BOTH orientations so a graphiti
          // pair can never shadow-duplicate a reversed deterministic term edge.
          const key = `${from} ${to} references`
          const reverseKey = `${to} ${from} references`
          if (edgeKeys.has(key) || edgeKeys.has(reverseKey)) continue
          if (addedEdges >= GRAPHITI_MAX_EDGES_PER_BUILD) {
            edgeCapHit = true
            break outer
          }
          edgeKeys.add(key)
          graph.edges.push({ from, to, type: 'references', source: 'graphiti', evidence: name })
          added = true
          addedEdges++
        }
      }
      if (edgeCapHit) break
    }
    if (entityCapHit) {
      console.warn(
        `docGraph: graphiti entity cap hit — processed ${GRAPHITI_MAX_ENTITIES_PER_BUILD} entities, remainder skipped`,
      )
    }
    if (edgeCapHit) {
      console.warn(
        `docGraph: graphiti edge cap hit — added ${GRAPHITI_MAX_EDGES_PER_BUILD} edges, remainder skipped`,
      )
    }
    if (added) graph.adjacency = buildAdjacency(graph.edges)
    graph.graphitiApplied = true
  } catch {
    // MCP unreachable, malformed reply, or deadline hit — the graph is fully
    // usable without this pass; return silently, never throw, never block.
  }
}

// --- Cache + entry points ---------------------------------------------------

const CACHE_MAX = 8
const graphCache = new Map<string, DocGraph>()
const inflight = new Map<string, Promise<DocGraph>>()

function cacheGraph(hash: string, graph: DocGraph): void {
  graphCache.delete(hash)
  graphCache.set(hash, graph)
  while (graphCache.size > CACHE_MAX) {
    const oldest = graphCache.keys().next().value
    if (oldest === undefined) break
    graphCache.delete(oldest)
  }
}

/**
 * Best prior graph for an incremental LLM pass: the cached, llm-applied graph
 * sharing the most per-block hashes with `graph` — and more than half of its
 * blocks, else the edit is too large to treat as incremental. There is no
 * documentId to key on, so hash overlap IS the document-identity heuristic.
 */
function findBestPriorGraph(graph: DocGraph, excludeHash: string): DocGraph | null {
  let best: DocGraph | null = null
  let bestOverlap = graph.blockHashes.size / 2 // strict >50% threshold
  for (const [hash, candidate] of graphCache) {
    if (hash === excludeHash || !candidate.llmApplied) continue
    let overlap = 0
    for (const [id, h] of graph.blockHashes) {
      if (candidate.blockHashes.get(id) === h) overlap++
    }
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      best = candidate
    }
  }
  return best
}

/**
 * Diff `graph` against a prior build: carries forward prior LLM edges whose
 * BOTH endpoints are unchanged (edges touching changed blocks are dropped for
 * re-extraction), inherits llmPartial, and returns the changed/new block ids.
 */
function carryForwardLlmEdges(graph: DocGraph, prior: DocGraph): Set<string> {
  const changed = new Set<string>()
  for (const [id, h] of graph.blockHashes) {
    if (prior.blockHashes.get(id) !== h) changed.add(id)
  }
  const edgeKeys = new Set(graph.edges.map((e) => `${e.from}${e.to}${e.type}`))
  for (const edge of prior.edges) {
    if (edge.source !== 'llm') continue
    if (changed.has(edge.from) || changed.has(edge.to)) continue
    if (!graph.nodes.has(edge.from) || !graph.nodes.has(edge.to)) continue
    const key = `${edge.from}${edge.to}${edge.type}`
    if (edgeKeys.has(key)) continue
    edgeKeys.add(key)
    graph.edges.push({ ...edge })
  }
  graph.adjacency = buildAdjacency(graph.edges)
  if (prior.llmPartial) graph.llmPartial = true
  return changed
}

/**
 * The seed blocks plus their 1-hop graph neighbors (union of the CURRENT
 * graph's adjacency and, when given, the PRIOR graph's adjacency).
 *
 * The prior adjacency is load-bearing: carryForwardLlmEdges DROPS every LLM
 * edge touching a changed block, and rebuilds the current adjacency after the
 * drop — so a dropped edge's far endpoint is invisible to the current
 * adjacency. Without seeding from the prior graph the far endpoint never
 * re-enters the re-extraction listing, the model can never re-propose the
 * link, and every incremental pass permanently destroys LLM edges touching
 * edited blocks (monotonic graph decay compounding across a session).
 */
function expandOneHop(
  graph: DocGraph,
  seed: ReadonlySet<string>,
  priorAdjacency?: Map<string, DocGraphEdge[]>,
): Set<string> {
  const out = new Set(seed)
  const addFar = (id: string, edge: DocGraphEdge) => {
    const far = edge.from === id ? edge.to : edge.from
    if (graph.nodes.has(far)) out.add(far)
  }
  for (const id of seed) {
    for (const edge of graph.adjacency.get(id) ?? []) addFar(id, edge)
    for (const edge of priorAdjacency?.get(id) ?? []) addFar(id, edge)
  }
  return out
}

/**
 * Monotonic publish sequence — every getDocGraph invocation allocates one seq
 * and stamps BOTH of its publishes ('building' and the final 'ready') with it.
 * The store compare-and-sets on the seq, so a slow older build finishing after
 * a newer publish can neither churn the chip back to 'building' nor overwrite
 * a fresher graph with a stale one.
 */
let publishSeq = 0

/**
 * Publish build lifecycle to the UI store (StatusBar chip, edge-path
 * affordances). Browser-only via lazy import — node tests and server code
 * never touch the store (same precedent as scheduleDocGraphRebuild's lazy
 * settings-store import). Failures are swallowed: publishing is cosmetic.
 */
function publishDocGraph(seq: number, status: 'building' | 'ready', graph?: DocGraph): void {
  if (typeof window === 'undefined') return
  void import('@/stores/docGraphStore')
    .then(({ useDocGraphStore }) => {
      useDocGraphStore.getState().publish(seq, status, graph)
    })
    .catch(() => {})
}

/** User toggle for the embedding pass (settings store, default true). */
async function embeddingsEnabledFromStore(): Promise<boolean> {
  try {
    const { useSettingsStore } = await import('@/stores/settingsStore')
    return useSettingsStore.getState().embeddingsEnabled
  } catch {
    return true
  }
}

/**
 * The cascade's graph entry point: content-hash cached, concurrent builds
 * deduped. Deterministic build is sync-fast and always global; the LLM pass is
 * incremental — when a cached prior graph covers most of the same blocks, its
 * edges between unchanged blocks are carried forward and only changed blocks
 * plus their 1-hop neighbors are re-extracted. The embedding pass runs after
 * the LLM pass (vector cache makes it incremental for free). Both passes are
 * silently skipped when no provider is callable (graph stays usable).
 */
export async function getDocGraph(
  doc: PMNode,
  config: LLMConfig,
  deps: {
    callStructured?: CallStructuredFn
    skipLlm?: boolean
    /** Skip the embedding pass regardless of the user setting (background rebuilds). */
    skipEmbeddings?: boolean
    embed?: EmbedFn
    /** Test/caller override for the settings-store embeddings toggle. */
    embeddingsEnabled?: boolean
    /** Skip the Graphiti entity pass (background rebuilds — user-initiated only). */
    skipGraphiti?: boolean
    /** Injectable Graphiti MCP client (tests: scripted searchNodes/getSubgraph). */
    graphiti?: GraphitiEdgeDeps
  } = {},
): Promise<DocGraph> {
  const hash = contentHash(doc)
  const embeddingsOn =
    !deps.skipEmbeddings &&
    llmAvailable(config) &&
    (deps.embeddingsEnabled ?? (await embeddingsEnabledFromStore()))
  const cached = graphCache.get(hash)
  if (
    cached &&
    (cached.llmApplied || deps.skipLlm || !llmAvailable(config)) &&
    (cached.embeddingsApplied || !embeddingsOn)
  ) {
    // Cache hits publish too — a fresh page with a warm cache still needs the
    // UI store filled before the chip / edge paths can render. Synchronous
    // resolution: publish 'ready' directly, never a 'building' flicker.
    publishDocGraph(++publishSeq, 'ready', cached)
    return cached
  }
  const pending = inflight.get(hash)
  if (pending) return pending

  const seq = ++publishSeq
  publishDocGraph(seq, 'building')
  const promise = (async () => {
    const graph = cached ?? buildDeterministicGraph(doc)
    if (!deps.skipLlm && !graph.llmApplied) {
      let targetIds: Set<string> | undefined
      const prior = findBestPriorGraph(graph, hash)
      if (prior) {
        const changed = carryForwardLlmEdges(graph, prior)
        // Union with the prior adjacency so far endpoints of DROPPED LLM
        // edges re-enter the listing and can be re-proposed.
        targetIds = expandOneHop(graph, changed, prior.adjacency)
      }
      await augmentWithLlmEdges(graph, config, deps.callStructured ?? fetchStructured, targetIds)
    }
    if (embeddingsOn && !graph.embeddingsApplied) {
      await augmentWithEmbeddingEdges(graph, config, deps.embed)
    }
    // Graphiti entity edges: user-initiated builds only (same privacy stance
    // as the LLM/embedding passes — background typing must never trigger MCP
    // traffic). Deliberately NOT part of the cache-hit condition above: when
    // FalkorDB is down (the usual dev state) a warm cache must not re-pay the
    // connection attempt on every cascade.
    if (!deps.skipGraphiti && !graph.graphitiApplied) {
      await augmentWithGraphitiEdges(graph, deps.graphiti)
    }
    cacheGraph(hash, graph)
    publishDocGraph(seq, 'ready', graph)
    return graph
  })().finally(() => inflight.delete(hash))

  inflight.set(hash, promise)
  return promise
}

export interface NeighborhoodEntry {
  /** BFS hop distance (0 = the block itself). */
  hop: number
  /**
   * Best (lowest) SOURCE_PRIORITY among the edges that connected the block at
   * its discovery hop — a block reachable through a deterministic edge ranks
   * ahead of one reachable only through a graphiti co-mention at the same hop.
   * 0 for the seed block itself.
   */
  sourceRank: number
}

/** BFS over the undirected adjacency: blockId → { hop, sourceRank }. */
export function getNeighborhood(
  graph: DocGraph,
  blockId: string,
  hops: number,
): Map<string, NeighborhoodEntry> {
  const dist = new Map<string, NeighborhoodEntry>()
  if (!graph.nodes.has(blockId)) return dist
  dist.set(blockId, { hop: 0, sourceRank: 0 })
  let frontier = [blockId]
  for (let hop = 1; hop <= hops && frontier.length; hop++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const edge of graph.adjacency.get(id) ?? []) {
        const neighbor = edge.from === id ? edge.to : edge.from
        const rank = SOURCE_PRIORITY[edge.source]
        const existing = dist.get(neighbor)
        if (!existing) {
          dist.set(neighbor, { hop, sourceRank: rank })
          next.push(neighbor)
        } else if (existing.hop === hop && rank < existing.sourceRank) {
          // Another edge reaches the same block at its discovery hop with a
          // higher-precision source — keep the best rank.
          existing.sourceRank = rank
        }
      }
    }
    frontier = next
  }
  return dist
}

/**
 * BFS shortest path over the undirected adjacency, as the ordered edge list
 * walked from `fromBlockId` to `toBlockId`. Returns [] when the endpoints are
 * the same block, null when either endpoint is unknown or no path exists.
 * Each node's edges are walked in SOURCE_PRIORITY order (stable sort), so on
 * equal-length paths the "why this proposal?" line surfaces the
 * higher-precision evidence (deterministic/llm/embedding before graphiti).
 * Pure — powers the "why this proposal?" affordance.
 */
export function findEdgePath(
  graph: DocGraph,
  fromBlockId: string,
  toBlockId: string,
): DocGraphEdge[] | null {
  if (!graph.nodes.has(fromBlockId) || !graph.nodes.has(toBlockId)) return null
  if (fromBlockId === toBlockId) return []

  const bySourcePriority = (edges: DocGraphEdge[]): DocGraphEdge[] =>
    [...edges].sort((a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source])

  const cameFrom = new Map<string, { via: DocGraphEdge; prev: string }>()
  const visited = new Set([fromBlockId])
  let frontier = [fromBlockId]
  while (frontier.length) {
    const next: string[] = []
    for (const id of frontier) {
      for (const edge of bySourcePriority(graph.adjacency.get(id) ?? [])) {
        const far = edge.from === id ? edge.to : edge.from
        if (visited.has(far)) continue
        visited.add(far)
        cameFrom.set(far, { via: edge, prev: id })
        if (far === toBlockId) {
          const path: DocGraphEdge[] = []
          let cursor = toBlockId
          while (cursor !== fromBlockId) {
            const step = cameFrom.get(cursor)!
            path.unshift(step.via)
            cursor = step.prev
          }
          return path
        }
        next.push(far)
      }
    }
    frontier = next
  }
  return null
}

const EDGE_EVIDENCE_MAX_CHARS = 24

/**
 * Human-readable rendering of an edge path for the "why this proposal?" line,
 * e.g. `references ("Total Budget") → contradicts`. Plain text only — callers
 * must never inject it as HTML. Evidence terms are truncated to keep the line
 * compact.
 */
export function formatEdgePath(path: DocGraphEdge[]): string {
  return path
    .map((edge) => {
      if (!edge.evidence) return edge.type
      const term =
        edge.evidence.length > EDGE_EVIDENCE_MAX_CHARS
          ? edge.evidence.slice(0, EDGE_EVIDENCE_MAX_CHARS).trimEnd() + '…'
          : edge.evidence
      return `${edge.type} ("${term}")`
    })
    .join(' → ')
}

let rebuildTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Debounced background rebuild, wired into the editor's dispatchTransaction so
 * the cascade usually hits a warm deterministic graph. Deliberately
 * DETERMINISTIC-ONLY (`skipLlm` + `skipEmbeddings` + `skipGraphiti`): document
 * text must never leave the machine (or process) as a side effect of typing —
 * the LLM extraction, embedding, and Graphiti passes run lazily inside the
 * cascade, which the user explicitly initiated. All failures are swallowed.
 */
export function scheduleDocGraphRebuild(view: EditorView, delayMs = 2000): void {
  if (rebuildTimer) clearTimeout(rebuildTimer)
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null
    if (view.isDestroyed) return
    void (async () => {
      const { useSettingsStore } = await import('@/stores/settingsStore')
      await getDocGraph(view.state.doc, useSettingsStore.getState().llmConfig, {
        skipLlm: true,
        skipEmbeddings: true,
        skipGraphiti: true,
      })
    })().catch(() => {})
  }, delayMs)
}

/** Cancel any pending background rebuild (editor unmount). */
export function cancelScheduledDocGraphRebuild(): void {
  if (rebuildTimer) {
    clearTimeout(rebuildTimer)
    rebuildTimer = null
  }
}

/** Test hygiene: clear cache, inflight builds, and any pending rebuild. */
export function invalidateDocGraphCache(): void {
  graphCache.clear()
  inflight.clear()
  cancelScheduledDocGraphRebuild()
}
