import type { DocGraph, DocGraphEdge, DocGraphEdgeSource } from './docGraph'

/**
 * How much a graph edge actually justifies showing one passage next to
 * another.
 *
 * The graph answers "is there a path between these blocks". That is not the
 * same question as "does this passage bear on what I am reading", and treating
 * it as if it were is what produced the reported nonsense: a passage about
 * "Jira + Splunk access-grant reconciliation" surfaced two unrelated passages
 * labelled `references ("Sections 8")` and
 * `references ("Sections 8") → references ("Aegis")`. Retrieval returned the
 * top N neighbours because they were the only N neighbours — there was no
 * score, no threshold, and no way to express "nothing here is related".
 *
 * The score has two factors, and the second is the one that matters:
 *
 *   score = structural × corroboration
 *
 * `structural` is the graph's own confidence, decayed by distance.
 * `corroboration` asks whether the two passages actually talk about the same
 * things, and applies UNCONDITIONALLY to every multi-hop path — a two-hop
 * connection is transitive inference, never evidence, however confident each
 * individual step was.
 *
 * No model calls and no network: this runs on mouse-up.
 */

/**
 * Default confidence per edge source, used only when an edge carries no
 * `weight` of its own. Deterministic and embedding edges built by this module
 * do carry one; hand-built and legacy edges fall back here.
 *
 * Mirrors the ordering `SOURCE_PRIORITY` already encodes, as magnitudes.
 * Graphiti sits far below the rest because "both blocks mention this entity
 * name" is the weakest claim in the system.
 */
export const SOURCE_CONFIDENCE: Record<DocGraphEdgeSource, number> = {
  deterministic: 0.9,
  llm: 0.8,
  embedding: 0.75,
  graphiti: 0.45,
}

/** Per-hop decay. One step of transitivity should be felt, not fatal. */
export const HOP_DECAY = 0.75

/**
 * What a weak-provenance edge keeps when the two passages share no rare
 * vocabulary at all. Enough that a genuine paraphrase is not punished for
 * using different words; little enough that two hops of it fall under the
 * floor.
 */
export const CORROB_FLOOR = 0.55

/**
 * Share of the shorter passage's IDF mass that counts as full corroboration.
 * Two passages about the same subsystem clear this easily; two passages that
 * merely both mention a project-wide noun do not.
 */
export const LEX_TARGET = 0.15

/** Minimum defined-term edge weight that still justifies itself alone. */
export const TERM_SELF_JUSTIFY = 0.7

/**
 * The cut-off, chosen to separate two computed sets rather than by feel.
 *
 * With no shared vocabulary, corroboration is CORROB_FLOOR, so the weakest
 * links land at:
 *
 *   graphiti co-mention, 1 hop     0.45 × 0.55           = 0.248
 *   ordinal-guess ref, 1 hop       0.60 × 0.55           = 0.330
 *   hub-ish defined term, 1 hop    0.63 × 0.55           = 0.347
 *   two author-written refs, 2 hop 0.95² × 0.75 × 0.55   = 0.372   ← highest reject
 *
 * With full corroboration, or as a link the author actually wrote, the
 * weakest things worth showing land at:
 *
 *   hub-ish defined term + overlap 0.63 × 1.0            = 0.630   ← lowest accept
 *   two refs, 2 hop + overlap      0.95² × 0.75 × 1.0    = 0.677
 *   author-written ref, 1 hop      0.95 × 1.0            = 0.950
 *
 * 0.45 sits in the gap (0.372 … 0.630) with room either side. Re-derive it
 * with `scripts/calibrate-relevance.ts`, which dumps every candidate pair with
 * its score, rather than arguing about it.
 */
export const RELATED_MIN_SCORE = 0.45

/** Confidence of one edge: its own weight, else its source's default. */
export function edgeConfidence(edge: DocGraphEdge): number {
  if (typeof edge.weight === 'number' && Number.isFinite(edge.weight)) {
    return Math.min(1, Math.max(0, edge.weight))
  }
  return SOURCE_CONFIDENCE[edge.source] ?? 0.5
}

/**
 * Whether an edge stands on its own — the author wrote the link, or the two
 * passages are verifiably the same text — versus needing the passages to also
 * share vocabulary before one is shown for the other.
 *
 * A legacy edge with no `kind` is treated as self-justifying. That is
 * deliberate: hand-built graphs (every fixture in the test suite, and any
 * graph cached before this field existed) would otherwise all fail
 * corroboration and disappear, which is a far worse failure than being
 * slightly too permissive on data this module did not build.
 */
export function isSelfJustifying(edge: DocGraphEdge): boolean {
  switch (edge.source) {
    case 'deterministic':
      switch (edge.kind) {
        case 'named-ref':
        case 'section-number':
        case 'verbatim':
          return true
        // The positional-index guess. Not evidence; must corroborate.
        case 'section-ordinal':
          return false
        // A term used in a handful of places justifies itself; one used
        // everywhere is a project noun and has to prove the link.
        case 'defined-term':
          return edgeConfidence(edge) >= TERM_SELF_JUSTIFY
        default:
          return true
      }
    case 'embedding':
      // Its cosine threshold already gated it at build time.
      return true
    case 'llm':
      // Only a verified verbatim quote is evidence; a bare assertion is not.
      return typeof edge.evidence === 'string' && edge.evidence.trim().length > 0
    case 'graphiti':
      return false
    default:
      return false
  }
}

// --- IDF index --------------------------------------------------------------

interface TermIndex {
  /** blockId → its distinct content tokens. */
  tokens: Map<string, Set<string>>
  /** token → inverse document frequency across blocks. */
  idf: Map<string, number>
  /** blockId → total IDF mass of its tokens. */
  mass: Map<string, number>
}

/**
 * Held per-graph in a WeakMap rather than as a field on DocGraph. A required
 * field would break `tsc --noEmit` on every hand-built graph literal in the
 * test suite, and an optional one invites a half-populated graph. The WeakMap
 * is equivalent and releases with the graph.
 */
const indexCache = new WeakMap<DocGraph, TermIndex>()

/** Words too common to distinguish anything. Kept small on purpose — IDF
 *  handles the rest, and per-document frequency beats a fixed list. */
const LEX_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'these', 'those', 'from', 'into',
  'have', 'has', 'had', 'was', 'were', 'are', 'you', 'your', 'not', 'but', 'its',
  'it', 'they', 'them', 'their', 'which', 'when', 'what', 'who', 'how', 'why',
  'can', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'all',
  'any', 'each', 'more', 'most', 'other', 'some', 'such', 'than', 'then',
  'there', 'here', 'also', 'been', 'being', 'over', 'under', 'about', 'use',
  'used', 'using', 'one', 'two', 'per', 'via', 'out', 'off', 'own', 'because',
])

/** Content tokens of a passage: words of 3+ letters, stopwords removed. */
function tokenize(text: string): Set<string> {
  const out = new Set<string>()
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}'’-]+/u)) {
    const token = raw.replace(/^['’-]+|['’-]+$/g, '')
    if (token.length < 3) continue
    if (LEX_STOPWORDS.has(token)) continue
    out.add(token)
  }
  return out
}

function termIndex(graph: DocGraph): TermIndex {
  const cached = indexCache.get(graph)
  if (cached) return cached

  const tokens = new Map<string, Set<string>>()
  const df = new Map<string, number>()
  for (const node of graph.nodes.values()) {
    const set = tokenize(node.text)
    tokens.set(node.blockId, set)
    for (const t of set) df.set(t, (df.get(t) ?? 0) + 1)
  }

  const blockCount = Math.max(1, tokens.size)
  const idf = new Map<string, number>()
  for (const [token, count] of df) {
    // A token in EVERY block must contribute (almost) nothing — that is what
    // separates a real subject-matter overlap from two passages that merely
    // both say "Aegis".
    //
    // Two variants were tried and rejected against the tests below.
    // log(1 + N/(1+df)) bottoms out near 0.65 instead of 0, so a
    // document-wide term still carried most of the weight. Plain log(N/df)
    // hits exactly 0 — but in a small graph EVERY shared token has df = N by
    // definition, so a 2-block or 3-block document scored every pair at zero
    // overlap and nothing multi-hop could ever surface. Short documents are
    // not an edge case here; they are most documents.
    //
    // This form degrades smoothly between the two: ~0.004 for a token in all
    // of 120 blocks, ~0.18 for one in both of 2, and ~3.9 for one in 2 of 120.
    idf.set(token, Math.max(0, Math.log((blockCount + 1) / (count + 0.5))))
  }

  const mass = new Map<string, number>()
  for (const [blockId, set] of tokens) {
    let total = 0
    for (const t of set) total += idf.get(t) ?? 0
    mass.set(blockId, total)
  }

  const index: TermIndex = { tokens, idf, mass }
  indexCache.set(graph, index)
  return index
}

/**
 * Build the index eagerly. Called when a graph is published so the first
 * mouse-up does not pay for it — a lazy first call over a 600-block document
 * is a visible hitch in a popup that must appear instantly.
 */
export function warmTermIndex(graph: DocGraph): void {
  termIndex(graph)
}

/** Drop a graph's memoised index. Test hygiene; graphs are otherwise immutable
 *  enough that the cache never needs clearing in production. */
export function clearTermIndexCache(graph: DocGraph): void {
  indexCache.delete(graph)
}

/**
 * IDF-weighted vocabulary overlap between two blocks, in [0,1].
 *
 * Normalised by the SMALLER side's mass, so a short passage fully covered by a
 * long one still scores high — otherwise every one-line block would look
 * unrelated to every section it belongs to.
 */
export function lexicalOverlap(graph: DocGraph, a: string, b: string): number {
  const index = termIndex(graph)
  const ta = index.tokens.get(a)
  const tb = index.tokens.get(b)
  if (!ta || !tb || ta.size === 0 || tb.size === 0) return 0

  // Iterate the smaller set — the intersection is the same either way.
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta]
  let shared = 0
  for (const token of small) {
    if (large.has(token)) shared += index.idf.get(token) ?? 0
  }

  const denom = Math.min(index.mass.get(a) ?? 0, index.mass.get(b) ?? 0)
  if (denom <= 0) return 0
  return Math.min(1, shared / denom)
}

// --- Scoring ----------------------------------------------------------------

function corroboration(graph: DocGraph, seedId: string, targetId: string, path: DocGraphEdge[]): number {
  const direct = path.length === 1 && path.every(isSelfJustifying)
  if (direct) return 1
  const overlap = lexicalOverlap(graph, seedId, targetId)
  return CORROB_FLOOR + (1 - CORROB_FLOOR) * Math.min(1, overlap / LEX_TARGET)
}

/**
 * Score one candidate passage.
 *
 * `hop` is the BFS distance `getNeighborhood` reports. `path` is the walked
 * edge list from `findEdgePath`; an empty or missing path means the graph
 * connects them by a route this scorer cannot inspect, which is scored as a
 * single weakest-source edge rather than trusted.
 */
export function scorePath(
  graph: DocGraph,
  seedId: string,
  targetId: string,
  path: DocGraphEdge[] | null,
  hop: number,
): number {
  const walked = path && path.length ? path : null
  const structural = walked
    ? walked.reduce((acc, e) => acc * edgeConfidence(e), 1)
    : SOURCE_CONFIDENCE.graphiti
  const decayed = structural * Math.pow(HOP_DECAY, Math.max(0, hop - 1))
  const corrob = walked
    ? corroboration(graph, seedId, targetId, walked)
    : // No inspectable path: never self-justifying.
      CORROB_FLOOR + (1 - CORROB_FLOOR) * Math.min(1, lexicalOverlap(graph, seedId, targetId) / LEX_TARGET)
  return decayed * corrob
}

/**
 * Scores for the seed's direct neighbours only, walking `adjacency` rather
 * than running a BFS.
 *
 * Exists for the selection popup, which must offer something the instant the
 * mouse comes up. One hop, not two, and O(degree) rather than O(graph).
 */
export function scoreOneHopNeighbors(graph: DocGraph, seedId: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const edge of graph.adjacency.get(seedId) ?? []) {
    const other = edge.from === seedId ? edge.to : edge.from
    if (other === seedId) continue
    const score = scorePath(graph, seedId, other, [edge], 1)
    // Several edges can connect the same pair; the best one speaks for it.
    const prior = out.get(other)
    if (prior === undefined || score > prior) out.set(other, score)
  }
  return out
}
