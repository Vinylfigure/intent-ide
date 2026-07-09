import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import type { LLMConfig } from '@/stores/settingsStore'
import type { CascadeEdgeType } from '@/lib/annotations/types'
import { collectTextblocks } from '@/lib/prosemirror/blockIds'
import { fetchStructured, type CallStructuredFn } from '@/lib/ai/structuredClient'

/**
 * Document dependency graph — the retrieval index the cascade queries instead
 * of the raw document text. Nodes are textblocks keyed by stable blockId;
 * edges are typed relations from deterministic extractors (cross-references,
 * defined terms, duplicated sentences) plus one cached LLM extraction pass.
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

export type DocGraphEdgeSource = 'deterministic' | 'llm' | 'graphiti'

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

/** Skip the LLM pass beyond this many textblocks (deterministic edges only). */
const LLM_PASS_MAX_BLOCKS = 200

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
    update('')
    update(b.node.textContent)
    update('')
  }
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

  for (const b of blocks) {
    if (!b.blockId) continue
    const text = b.node.textContent
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
 * One extraction call per document. Mutates `graph` in place: validated LLM
 * edges are merged and `llmApplied` flips true. Failures leave the
 * deterministic graph intact and `llmApplied` false — never throws.
 */
export async function augmentWithLlmEdges(
  graph: DocGraph,
  config: LLMConfig,
  call: CallStructuredFn = fetchStructured,
): Promise<void> {
  if (graph.llmApplied) return
  if (graph.nodes.size === 0 || graph.nodes.size > LLM_PASS_MAX_BLOCKS) return
  if (!llmAvailable(config)) return

  const listing = [...graph.nodes.values()]
    .sort((a, b) => a.pos - b.pos)
    .map((n) => `[${n.blockId}] ${n.text}`)
    .join('\n')

  let toolCalls
  try {
    const res = await call(
      {
        messages: [
          { role: 'system', content: LINK_SYSTEM },
          { role: 'user', content: `DOCUMENT BLOCKS:\n${listing}` },
        ],
        tools: [LINK_BLOCKS_TOOL],
        maxTokens: 2000,
        temperature: 0.1,
      },
      config,
    )
    toolCalls = res.toolCalls
  } catch {
    return
  }

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
  graph.llmApplied = true
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
 * The cascade's graph entry point: content-hash cached, concurrent builds
 * deduped. Deterministic build is sync-fast; the LLM pass is awaited once and
 * silently skipped when no provider is callable (graph stays usable).
 */
export async function getDocGraph(
  doc: PMNode,
  config: LLMConfig,
  deps: { callStructured?: CallStructuredFn; skipLlm?: boolean } = {},
): Promise<DocGraph> {
  const hash = contentHash(doc)
  const cached = graphCache.get(hash)
  if (cached && (cached.llmApplied || deps.skipLlm || !llmAvailable(config))) {
    return cached
  }
  const pending = inflight.get(hash)
  if (pending) return pending

  const promise = (async () => {
    const graph = cached ?? buildDeterministicGraph(doc)
    if (!deps.skipLlm) {
      await augmentWithLlmEdges(graph, config, deps.callStructured ?? fetchStructured)
    }
    cacheGraph(hash, graph)
    return graph
  })().finally(() => inflight.delete(hash))

  inflight.set(hash, promise)
  return promise
}

/** BFS over the undirected adjacency: blockId → hop distance (0 = the block itself). */
export function getNeighborhood(
  graph: DocGraph,
  blockId: string,
  hops: number,
): Map<string, number> {
  const dist = new Map<string, number>()
  if (!graph.nodes.has(blockId)) return dist
  dist.set(blockId, 0)
  let frontier = [blockId]
  for (let hop = 1; hop <= hops && frontier.length; hop++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const edge of graph.adjacency.get(id) ?? []) {
        const neighbor = edge.from === id ? edge.to : edge.from
        if (!dist.has(neighbor)) {
          dist.set(neighbor, hop)
          next.push(neighbor)
        }
      }
    }
    frontier = next
  }
  return dist
}

let rebuildTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Debounced background rebuild, wired into the editor's dispatchTransaction so
 * the cascade usually hits a warm cache. Reads the live LLM config at fire
 * time; all failures are swallowed (the cascade degrades gracefully).
 */
export function scheduleDocGraphRebuild(view: EditorView, delayMs = 2000): void {
  if (rebuildTimer) clearTimeout(rebuildTimer)
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null
    void (async () => {
      const { useSettingsStore } = await import('@/stores/settingsStore')
      await getDocGraph(view.state.doc, useSettingsStore.getState().llmConfig)
    })().catch(() => {})
  }, delayMs)
}

/** Test hygiene: clear cache, inflight builds, and any pending rebuild. */
export function invalidateDocGraphCache(): void {
  graphCache.clear()
  inflight.clear()
  if (rebuildTimer) {
    clearTimeout(rebuildTimer)
    rebuildTimer = null
  }
}
