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
import { getEpisodeGeneration } from './episodeIngestion'

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
 *
 * NOT a stable-once-built value object: a cached graph can be mutated AND
 * re-published under the SAME object reference by a later `getDocGraph` call
 * for the same content hash — e.g. a Graphiti retry after a new episode
 * lands (see `graphitiEpisodeGen`). `docGraphStore`'s Zustand selector
 * bails out on `Object.is` equality, so an already-mounted component that
 * isn't re-rendering for some other reason at that moment can read a
 * momentarily-stale `edges`/`adjacency` off an old render. `proposeCascadeEdits`
 * is unaffected (it always awaits a fresh `getDocGraph` return value); this
 * only risks a stale "why this proposal?" explainer line — see #138.
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

/**
 * What kind of evidence produced an edge, within its source.
 *
 * `source` says WHO found the link; `kind` says WHY it holds, which is a
 * different and more useful question when deciding whether to show a passage
 * to a human. A `section-number` edge is the author writing "see Section 8.2";
 * a `section-ordinal` edge is this module GUESSING that "Section 8" means the
 * eighth heading. Both are deterministic; only one is evidence.
 */
export type DocGraphEdgeKind =
  | 'section-number'
  | 'section-ordinal'
  | 'named-ref'
  | 'defined-term'
  | 'verbatim'
  | 'similarity'
  | 'co-mention'

export interface DocGraphEdge {
  from: string
  to: string
  type: CascadeEdgeType
  source: DocGraphEdgeSource
  /** Matched term or verified verbatim quote that produced this edge. */
  evidence?: string
  /** Why this edge holds, within its source. Absent on legacy/hand-built edges. */
  kind?: DocGraphEdgeKind
  /**
   * Confidence in [0,1]. Absent means "use the source default" — see
   * SOURCE_CONFIDENCE in relevanceScore.ts. Present on every deterministic
   * edge this module builds, because a defined-term edge's trustworthiness
   * depends on how many blocks that term links, which only the builder knows.
   */
  weight?: number
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
  /**
   * The episodeIngestion generation (see `getEpisodeGeneration`) as of the
   * last time the Graphiti pass was ATTEMPTED for this graph object — set on
   * success and on failure alike, -1 before any attempt. A warm-cache graph
   * only skips re-attempting Graphiti when this still matches the current
   * generation; a new episode ingested since (even for the same, unchanged
   * content hash) advances the generation and forces one retry.
   */
  graphitiEpisodeGen: number
  /** Per-textblock FNV-1a over blockId + text — the incremental-diff unit. */
  blockHashes: Map<string, string>
  nodes: Map<string, DocGraphNode>
  edges: DocGraphEdge[]
  /** Undirected index: blockId → edges touching it. */
  adjacency: Map<string, DocGraphEdge[]>
  /**
   * Defined terms dropped for linking too much of the document — a
   * project-wide noun rather than a definition. Recorded rather than silently
   * discarded so the absence of edges is explicable.
   */
  hubTerms?: string[]
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

/**
 * Words people bold at the START of a paragraph as a label, not as a glossary
 * entry. Without this, "**Note**: ..." defines a term called "Note" and every
 * block containing the word "note" links to it.
 */
const BOLD_LEAD_STOPWORDS = new Set([
  'note', 'notes', 'example', 'examples', 'summary', 'warning', 'caution',
  'important', 'tip', 'tips', 'step', 'steps', 'overview', 'background',
  'scope', 'purpose', 'objective', 'objectives', 'goal', 'goals', 'status',
  'owner', 'owners', 'context', 'problem', 'solution', 'input', 'inputs',
  'output', 'outputs', 'todo', 'next', 'result', 'results', 'why', 'how',
  'what', 'best use', 'avoid', 'be ready for', 'a strong answer', 'key',
  'question', 'answer', 'goal', 'risk', 'risks', 'gap', 'gaps',
])

/**
 * A bold lead-in must be followed by at least this much text to count as a
 * definition. "**Aegis**: see below" labels; "**Aegis**: the internal
 * access-review service that reconciles grants nightly." defines.
 */
const MIN_DEFINITION_CHARS = 40

/** Shortest string still plausibly a defined term. */
const MIN_TERM_CHARS = 4

/**
 * A defined term linking more blocks than this is a project-wide noun, not a
 * definition, and its edges are dropped entirely.
 *
 * Eight is about the largest set a human still reads as "these specific
 * passages" rather than "everywhere". The Graphiti pass independently landed
 * near the same number for the same reason; deterministic edges need to be
 * stricter because nothing down-ranks them by source priority afterwards.
 */
const TERM_MAX_LINKED_BLOCKS = 8
/** ...or this share of the document, whichever binds first. */
const TERM_MAX_DF_RATIO = 0.12
/** Floor for short documents — a six-block fixture must keep its term edges. */
const TERM_MIN_LINKED_BLOCKS = 4

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
  // Leading strong-marked phrase followed by ':' or '—' (glossary style).
  //
  // This branch is why one project noun could hub the whole document: any
  // bolded lead-in became a "definition", and pass 2b then linked every block
  // containing that word to it. Four tightenings, all aimed at the difference
  // between a LABEL and a DEFINITION.
  const first = node.firstChild
  // A bold heading is a title, never a glossary entry.
  if (node.type.name !== 'heading' && first?.isText && first.text && first.marks.some((mk) => mk.type.name === 'strong')) {
    const term = first.text.replace(/[:——-]\s*$/, '').trim()
    const rest = text.slice(first.text.length)
    const definitionBody = rest.replace(/^\s*[:——-]\s*/, '').trim()
    if (
      (first.text.trim().endsWith(':') || /^\s*[:——]/.test(rest)) &&
      term.length >= MIN_TERM_CHARS &&
      term.length <= 40 &&
      !BOLD_LEAD_STOPWORDS.has(term.toLowerCase()) &&
      // Something long enough to actually be a definition must follow.
      definitionBody.length >= MIN_DEFINITION_CHARS
    ) {
      terms.push(term)
    }
  }
  return terms.filter(
    (t) => t.length >= MIN_TERM_CHARS && !TERM_STOPWORDS.has(t.toLowerCase()),
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

/**
 * An explicit pointer to one numbered section.
 *
 * SINGULAR only, and ranges/lists excluded. The plural form in prose is
 * almost always a range or a list — "Study Sections 8–14", "Sections 3, 4 and
 * 7" — and the old pattern matched those, then resolved "8" as a POSITIONAL
 * INDEX into the heading list. That produced the reported nonsense: a passage
 * about study sections linked to whatever heading happened to be eighth, and
 * the UI showed it as `references ("Sections 8")`. A genuine single pointer is
 * always singular English.
 */
const SECTION_NUMBER_RE = /\bsection\s+(\d+(?:\.\d+)*)\b(?!\s*(?:[–—-]|,|\band\b)\s*\d)/gi

/** A heading that numbers itself: "8. Access Reviews", "8.2 Grant reconciliation". */
const HEADING_NUMBER_RE = /^\s*(\d+(?:\.\d+)*)[.)]?\s+\S/
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
  // The author's OWN numbering ("8.2 Grant reconciliation" → "8.2"), which is
  // what "see Section 8.2" actually refers to. Distinct from position in the
  // heading list, which is what the old code guessed with.
  const headingByNumber = new Map<string, string>()
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
      const numbered = text.match(HEADING_NUMBER_RE)
      // First writer wins: a duplicated number is ambiguous, and silently
      // repointing to the later one would be a guess wearing a fact's clothes.
      if (numbered && !headingByNumber.has(numbered[1])) {
        headingByNumber.set(numbered[1], b.blockId)
      }
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
      const numbered = headingByNumber.get(m[1])
      if (numbered) {
        // The author numbered their headings and this pointer matches one:
        // the strongest signal in the whole deterministic pass.
        addEdge({
          from: node.blockId,
          to: numbered,
          type: 'references',
          source: 'deterministic',
          evidence: m[0],
          kind: 'section-number',
          weight: 0.95,
        })
        continue
      }
      // Positional fallback, allowed ONLY when the document numbers nothing —
      // there, ordinal position is the only available reading of "Section 3".
      // In a document that DOES number its headings, "Section 9" failing to
      // match means the author meant something this pass cannot see, and
      // pointing at the ninth block would be a fabrication. Dotted numbers
      // never fall back: there is no ordinal reading of "8.2".
      if (headingByNumber.size > 0 || m[1].includes('.')) continue
      const target = headingsInOrder[parseInt(m[1], 10) - 1]
      if (target) {
        addEdge({
          from: node.blockId,
          to: target.blockId,
          type: 'references',
          source: 'deterministic',
          evidence: m[0],
          kind: 'section-ordinal',
          // A guess, and scored as one: not self-justifying, so a passage
          // reached this way must also share vocabulary to be shown.
          weight: 0.6,
        })
      }
    }
    for (const m of node.text.matchAll(NAMED_REF_RE)) {
      const target = headingByNorm.get(normalizeHeading(m[1] ?? m[2]))
      if (target) {
        // "see the Data Handling section" — the author wrote the link.
        addEdge({
          from: node.blockId,
          to: target,
          type: 'references',
          source: 'deterministic',
          evidence: m[0],
          kind: 'named-ref',
          weight: 0.95,
        })
      }
    }
  }

  // Pass 2b: shared defined terms → `references` edges to the defining block.
  //
  // This pass, unbounded, was the single largest source of irrelevant
  // "related passages". A term used project-wide ("Aegis") linked EVERY block
  // containing it to one definer, making the whole document one hop from
  // itself — so any two passages looked related and the ranking had nothing
  // left to discriminate with.
  //
  // Two bounds now. A term linking more than `cap` blocks is a project-wide
  // noun rather than a definition and produces NO edges at all; surviving
  // edges are weighted DOWN by how many blocks they link, so a term used in
  // five or more places stops being self-justifying and must also corroborate
  // lexically before a passage reached through it is shown.
  //
  // Dropped rather than truncated on purpose: keeping "the first 8 in document
  // order" still surfaces irrelevant passages, just fewer of them, and
  // document order is not a relevance signal.
  const hubTerms: string[] = []
  const blockCount = nodes.size
  const termCap = Math.min(
    TERM_MAX_LINKED_BLOCKS,
    Math.max(TERM_MIN_LINKED_BLOCKS, Math.floor(blockCount * TERM_MAX_DF_RATIO)),
  )
  // Dedupe case-insensitively across definers: two blocks that both "define"
  // the same word must not each get their own full fan-in.
  const definerByTerm = new Map<string, { term: string; blockId: string }>()
  for (const definer of nodes.values()) {
    for (const term of definer.definedTerms) {
      const key = term.toLowerCase()
      if (!definerByTerm.has(key)) definerByTerm.set(key, { term, blockId: definer.blockId })
    }
  }

  for (const { term, blockId: definerId } of definerByTerm.values()) {
    const containing: string[] = []
    for (const other of nodes.values()) {
      if (other.blockId === definerId) continue
      if (containsTerm(other.text, term)) containing.push(other.blockId)
    }
    if (containing.length > termCap) {
      hubTerms.push(term)
      continue
    }
    // df=1 → 0.95, df=4 → 0.71, df=5 → 0.63, df=8 → 0.40.
    const weight = Math.min(0.95, Math.max(0.4, 0.95 - 0.08 * (containing.length - 1)))
    for (const from of containing) {
      addEdge({
        from,
        to: definerId,
        type: 'references',
        source: 'deterministic',
        evidence: term,
        kind: 'defined-term',
        weight,
      })
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
          kind: 'verbatim',
          // A sentence repeated verbatim is the author's own link, not an
          // inference — the highest-confidence edge the pass can make.
          weight: 0.95,
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
    graphitiEpisodeGen: -1,
    blockHashes,
    nodes,
    edges,
    adjacency: buildAdjacency(edges),
    hubTerms,
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
  /** Test override for `getEpisodeGeneration()` — the real episodeIngestion counter otherwise. */
  episodeGeneration?: number
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
 *
 * Retried, not just cached, per episode generation: a call is skipped only
 * when `graph.graphitiEpisodeGen` already matches the current
 * `getEpisodeGeneration()` — i.e. nothing has been ingested since this graph's
 * last attempt, success or failure. A new episode (ingested via
 * `ingestAnnotationEpisode`/`ingestEditEpisode`) bumps the generation and
 * forces exactly one more attempt on the next call, even for an unchanged
 * content hash and even after a prior success.
 *
 * `currentGen` is snapshotted before the (up to GRAPHITI_TIMEOUT_MS) MCP
 * round trip, so an episode landing mid-call is recorded as one generation
 * stale — self-correcting, since the next `getDocGraph` call recomputes the
 * live generation and detects the mismatch again; never a permanent miss.
 */
export async function augmentWithGraphitiEdges(
  graph: DocGraph,
  deps: GraphitiEdgeDeps = {},
): Promise<void> {
  const currentGen = deps.episodeGeneration ?? getEpisodeGeneration()
  if (graph.graphitiEpisodeGen === currentGen) return
  if (graph.nodes.size < 2) {
    graph.graphitiApplied = true
    graph.graphitiEpisodeGen = currentGen
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
    const edgeKeys = new Set(graph.edges.map((e) => `${e.from}\u0000${e.to}\u0000${e.type}`))
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
          const key = `${from}\u0000${to}\u0000references`
          const reverseKey = `${to}\u0000${from}\u0000references`
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
    graph.graphitiEpisodeGen = currentGen
  } catch {
    // MCP unreachable, malformed reply, or deadline hit — the graph is fully
    // usable without this pass; return silently, never throw, never block.
    // graphitiApplied stays false (retryable), but graphitiEpisodeGen still
    // advances so a warm cache doesn't hammer a down FalkorDB every cascade —
    // only a new episode (generation bump) earns another attempt.
    graph.graphitiEpisodeGen = currentGen
  }
}

// --- Cache + entry points ---------------------------------------------------

const CACHE_MAX = 8
const graphCache = new Map<string, DocGraph>()

/**
 * One in-flight build per content hash, tagged with the capability set it was
 * started with. Concurrent callers wanting the SAME (or a subset of the)
 * capabilities dedupe onto it, as before. A caller wanting MORE than the
 * in-flight build covers (e.g. a user-initiated cascade arriving while
 * scheduleDocGraphRebuild's deterministic-only background build is still
 * running) does NOT silently inherit the lower-capability result — see
 * getDocGraph below.
 */
interface InflightEntry {
  promise: Promise<DocGraph>
  /**
   * Whether this promise's build will run the LLM branch of
   * applyRequestedPasses (carry-forward + a live call attempt) — i.e. the
   * caller's raw intent (`llmRequested`), NOT availability-gated. Carry-
   * forward runs independent of whether a live model call can succeed, so a
   * concurrent caller whose own intent is true must never be satisfied by an
   * in-flight build whose intent was false, regardless of either caller's
   * availability at the moment they ask (availability can change between
   * builds sharing a warm cache entry).
   */
  llm: boolean
  embeddings: boolean
  graphiti: boolean
}
const inflight = new Map<string, InflightEntry>()

interface RequestedPasses {
  llm: boolean
  embeddings: boolean
  graphiti: boolean
}

/** Runs whichever of the three augmentation passes `wanted` marks true and the graph doesn't already carry — mutates `graph` in place. */
async function applyRequestedPasses(
  graph: DocGraph,
  hash: string,
  config: LLMConfig,
  deps: { callStructured?: CallStructuredFn; embed?: EmbedFn; graphiti?: GraphitiEdgeDeps },
  wanted: RequestedPasses,
): Promise<void> {
  if (wanted.llm && !graph.llmApplied) {
    let targetIds: Set<string> | undefined
    const prior = findBestPriorGraph(graph, hash)
    if (prior) {
      // Union with the prior adjacency so far endpoints of DROPPED LLM edges
      // re-enter the listing and can be re-proposed.
      const changed = carryForwardLlmEdges(graph, prior)
      targetIds = expandOneHop(graph, changed, prior.adjacency)
    }
    await augmentWithLlmEdges(graph, config, deps.callStructured ?? fetchStructured, targetIds)
  }
  if (wanted.embeddings && !graph.embeddingsApplied) {
    await augmentWithEmbeddingEdges(graph, config, deps.embed)
  }
  // Graphiti entity edges: user-initiated builds only (same privacy stance as
  // the LLM/embedding passes — background typing must never trigger MCP
  // traffic). No `!graph.graphitiApplied` gate here — that flag never resets
  // once true, which would permanently skip this call after the first
  // success. augmentWithGraphitiEdges own-guards on graphitiEpisodeGen, so it
  // is safe (and necessary) to call unconditionally whenever graphiti is
  // wanted: it no-ops when nothing has been ingested since its last attempt,
  // and retries exactly once per new episode otherwise.
  if (wanted.graphiti) {
    await augmentWithGraphitiEdges(graph, deps.graphiti)
  }
}

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
 * settings-store import).
 *
 * This used to be cosmetic — the store fed a status chip and the "why this
 * proposal?" edge paths. It is now load-bearing: the answer envelope's
 * related-passage layer, the selection popup's offer counts, and the
 * pre-apply blast-radius preview all read the published graph. A failure
 * here means the graph is built and reaches nobody, so it stays non-fatal
 * but is no longer silent.
 */
function publishDocGraph(seq: number, status: 'building' | 'ready', graph?: DocGraph): void {
  if (typeof window === 'undefined') return
  void import('@/stores/docGraphStore')
    .then(({ useDocGraphStore }) => {
      useDocGraphStore.getState().publish(seq, status, graph)
    })
    .catch((err) => {
      console.warn('[docGraph] could not publish graph to the UI store', err)
    })
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
  // `llmRequested` is the caller's raw intent (not skipped) — it's what gates
  // entering the LLM branch in applyRequestedPasses, matching the ORIGINAL
  // (pre-#127-fix) gate of `!deps.skipLlm && !graph.llmApplied`. That branch
  // does more than call the model: it carries forward previously-cached LLM
  // edges for unchanged blocks via findBestPriorGraph/carryForwardLlmEdges,
  // which must still run even when the model is currently unreachable (a
  // dropped API key must not silently erase edges the LLM already found on
  // an earlier build). `llmWanted` folds in availability and is used ONLY
  // for the cache-hit / inflight-capability bookkeeping below, where "will
  // this build ever actually set llmApplied" is the right question — never
  // as the gate for whether carry-forward runs.
  const llmRequested = !deps.skipLlm
  const llmWanted = llmRequested && llmAvailable(config)
  const embeddingsWanted =
    !deps.skipEmbeddings &&
    llmAvailable(config) &&
    (deps.embeddingsEnabled ?? (await embeddingsEnabledFromStore()))
  const graphitiWanted = !deps.skipGraphiti
  // What applyRequestedPasses actually attempts — llm uses raw intent
  // (see above); embeddings/graphiti have no analogous caller-side
  // side-effect independent of the call itself, so availability-aware is
  // correct for them (matches original behavior).
  const wanted: RequestedPasses = { llm: llmRequested, embeddings: embeddingsWanted, graphiti: graphitiWanted }

  // Same generation source augmentWithGraphitiEdges itself will consult, read
  // once so the fast-path decision and the eventual attempt (if any) agree.
  const episodeGen = deps.graphiti?.episodeGeneration ?? getEpisodeGeneration()
  const cached = graphCache.get(hash)
  if (
    cached &&
    // `!llmRequested`, not `!llmWanted`: the same intent-vs-availability
    // distinction from the top of this function applies here too — a cached
    // graph that never ran carry-forward (because the caller's raw intent
    // was skipLlm) must not be treated as a hit for a caller who DOES want
    // carry-forward now, even if that caller is currently unavailable. Using
    // the availability-gated flag here let an unavailable-but-requesting
    // caller silently accept a stale cache entry missing edges that
    // carry-forward would have restored — the same bug shape already fixed
    // for the `wanted` object above and the inflight `covers` check below,
    // just one call site further along.
    (cached.llmApplied || !llmRequested) &&
    (cached.embeddingsApplied || !embeddingsWanted) &&
    // A prior Graphiti attempt (success or failure) at the CURRENT episode
    // generation is still good; skipGraphiti call sites never need it at all.
    (deps.skipGraphiti || cached.graphitiEpisodeGen === episodeGen)
  ) {
    // Cache hits publish too — a fresh page with a warm cache still needs the
    // UI store filled before the chip / edge paths can render. Synchronous
    // resolution: publish 'ready' directly, never a 'building' flicker.
    publishDocGraph(++publishSeq, 'ready', cached)
    return cached
  }

  const existing = inflight.get(hash)
  if (existing) {
    // The llm clause compares against `llmRequested`, not `llmWanted`: an
    // in-flight build that skipped carry-forward (llmRequested was false
    // when IT started) must never satisfy a caller who wants carry-forward
    // now, even if that caller happens to be unavailable too — availability
    // gates only the live call inside applyRequestedPasses, never whether
    // carry-forward itself runs. Using the availability-folded flag here
    // reintroduces #127's exact bug one layer down, just triggered by an
    // availability flip instead of a skipLlm mismatch between callers.
    const covers =
      (existing.llm || !llmRequested) && (existing.embeddings || !embeddingsWanted) && (existing.graphiti || !graphitiWanted)
    if (covers) return existing.promise

    // The in-flight build (e.g. scheduleDocGraphRebuild's deterministic-only
    // background pass) was started without a capability this caller needs.
    // Chain onto it rather than silently inheriting its result: await the
    // SAME graph object, then run only the still-missing passes against it
    // before caching/publishing. The chain is serialized on one object (this
    // continuation only starts mutating once the prior build has fully
    // finished), so there is no concurrent-mutation race, and a THIRD caller
    // needing even more replaces this entry in `inflight` the same way.
    const seq = ++publishSeq
    publishDocGraph(seq, 'building')
    let entry: InflightEntry
    const built = (async () => {
      const graph = await existing.promise
      await applyRequestedPasses(graph, hash, config, deps, wanted)
      cacheGraph(hash, graph)
      publishDocGraph(seq, 'ready', graph)
      return graph
    })().finally(() => {
      if (inflight.get(hash) === entry) inflight.delete(hash)
    })
    entry = {
      promise: built,
      llm: existing.llm || llmRequested,
      embeddings: existing.embeddings || embeddingsWanted,
      graphiti: existing.graphiti || graphitiWanted,
    }
    inflight.set(hash, entry)
    return built
  }

  const seq = ++publishSeq
  publishDocGraph(seq, 'building')
  let entry: InflightEntry
  const built = (async () => {
    const graph = cached ?? buildDeterministicGraph(doc)
    await applyRequestedPasses(graph, hash, config, deps, wanted)
    cacheGraph(hash, graph)
    publishDocGraph(seq, 'ready', graph)
    return graph
  })().finally(() => {
    if (inflight.get(hash) === entry) inflight.delete(hash)
  })
  entry = { promise: built, llm: llmRequested, embeddings: embeddingsWanted, graphiti: graphitiWanted }
  inflight.set(hash, entry)
  return built
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

/**
 * The same path as `formatEdgePath`, in a sentence a reader can act on.
 *
 * `formatEdgePath` is machine provenance and stays byte-identical — it is what
 * the audit record carries and what tests assert on. But it was ALSO what the
 * UI showed, and `references ("Sections 8") → references ("Aegis")` tells a
 * human nothing except that something matched. Worse, it presented a two-hop
 * inference in exactly the same shape as a link the author wrote.
 *
 * `fromBlockId` is the passage the reader is looking at, so the sentence can be
 * written from their point of view ("defines a term used here" vs "uses a term
 * defined here" are different facts about the same edge).
 */
export function describeEdgePath(
  graph: DocGraph,
  path: DocGraphEdge[],
  fromBlockId: string,
): string {
  if (!path.length) return 'related'

  const quote = (text: string | undefined): string => {
    if (!text) return ''
    const clean = text.trim().replace(/\s+/g, ' ')
    return clean.length > EDGE_EVIDENCE_MAX_CHARS
      ? `${clean.slice(0, EDGE_EVIDENCE_MAX_CHARS).trimEnd()}…`
      : clean
  }

  /** One edge, described from `origin`'s side of it. */
  const describe = (edge: DocGraphEdge, origin: string): string => {
    const term = quote(edge.evidence)
    if (edge.source === 'graphiti') return term ? `both mention "${term}"` : 'both mention the same entity'
    if (edge.source === 'embedding') return 'says something closely similar'
    if (edge.source === 'llm') {
      return term ? `the model linked these on "${term}"` : 'the model linked these'
    }
    switch (edge.kind) {
      case 'named-ref':
        return term ? `cross-referenced as "${term}"` : 'cross-referenced here'
      case 'section-number':
        return term ? `pointed to by "${term}"` : 'pointed to by a section reference'
      case 'section-ordinal':
        // Say out loud that this one is a guess.
        return term ? `possibly "${term}" — matched by position, not by number` : 'matched by position'
      case 'defined-term':
        // The edge runs user → definer, so which sentence is true depends on
        // which end the reader is standing at.
        return origin === edge.to
          ? `uses "${term}", which this passage defines`
          : `defines "${term}", used here`
      case 'verbatim':
        return 'repeats a sentence from this passage'
      default:
        return term ? `${edge.type} "${term}"` : edge.type
    }
  }

  const last = path[path.length - 1]
  if (path.length === 1) return describe(last, fromBlockId)

  // Multi-hop. Name what it went through, so a transitive connection is never
  // mistaken for a direct one.
  const first = path[0]
  const viaId = first.from === fromBlockId ? first.to : first.from
  const via = graph.nodes.get(viaId)
  const label = via?.headingPath?.length
    ? via.headingPath[via.headingPath.length - 1]
    : quote(via?.text.split(/\s+/).slice(0, 6).join(' '))
  const tail = describe(last, viaId)
  return label ? `indirectly, via "${label}": ${tail}` : `indirectly: ${tail}`
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
    })().catch((err) => {
      // Swallowing this entirely meant a failed build left the graph null
      // forever with no signal anywhere — every consumer degrading silently
      // and permanently. Still non-fatal (the editor must not break because
      // an index failed), but no longer invisible.
      console.warn('[docGraph] background rebuild failed; section map unavailable', err)
    })
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
