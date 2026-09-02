import type { EditorState } from 'prosemirror-state'
import type { Scope } from '@/lib/annotations/types'
import { getBlockText, getSectionText } from '@/lib/prosemirror/helpers'
import { blockIdAtPos } from '@/lib/prosemirror/blockIds'
import {
  describeEdgePath,
  findEdgePath,
  formatEdgePath,
  getNeighborhood,
  type DocGraph,
} from '@/lib/graphrag/docGraph'
import { RELATED_MIN_SCORE, scoreOneHopNeighbors, scorePath } from '@/lib/graphrag/relevanceScore'
import { useDocGraphStore } from '@/stores/docGraphStore'
import { useDocumentStore } from '@/stores/documentStore'
import { listInvariants, type Invariant } from '@/lib/invariants/captureInvariant'
import { useAnnotationStore } from '@/stores/annotationStore'

/**
 * The context envelope handed to the resolver.
 *
 * Before this module the resolver's context was purely POSITIONAL — the block
 * containing the span plus the first 1000 chars of its section. That answers
 * "what is physically near this selection", which is not the same question as
 * "what in this document bears on it". A term defined three sections up, a
 * figure duplicated in an appendix, or a fact the author explicitly declared
 * are all invisible to proximity and all already indexed by the doc graph
 * (`lib/graphrag/docGraph.ts`) and the invariant ledger.
 *
 * This assembles both into one budgeted envelope. Every layer is capped,
 * because the envelope is spent against the model's context window: the local
 * Ollama path runs at 4096 tokens, where an unbounded envelope does not error
 * — it silently truncates the document and yields a confident answer grounded
 * in half the evidence. Caps scale with scope, so a phrase-level question does
 * not drag a section's worth of neighbours along with it.
 *
 * Degrades cleanly at every step: a cold graph, an unknown block, or a failed
 * invariant fetch each drop their own layer and leave the rest intact. The
 * caller always gets the positional layers it had before.
 */
export interface IntentContext {
  /** The block containing the span — the pre-existing positional layer. */
  localBlock: string
  /** The span's section, truncated — the pre-existing positional layer. */
  sectionText: string
  /** Enclosing headings, outermost first. What this section is FOR. */
  headingPath: string[]
  /** Terms this block defines, per the graph's deterministic extractor. */
  definedTerms: string[]
  /** Passages elsewhere that bear on this span, most relevant first. */
  related: RelatedPassage[]
  /**
   * Candidates the graph offered that scored below the relevance floor.
   *
   * Distinguishes "this document has nothing else on the subject" (checked, >0
   * rejected) from "no candidates existed" (0) — and both from a cold graph,
   * which `graphUnavailable` reports. An empty `related` alone is ambiguous
   * between all three, and that ambiguity is what let a model fill the silence
   * with an invented cross-reference.
   */
  relatedSuppressed: number
  /** Facts the author declared that touch this span or its neighbours. */
  invariants: string[]
  /**
   * The selected term, when the document demonstrably does NOT define it —
   * it appears in the text but no block defines it, per the graph's
   * deterministic extractor. Null when the document does define it, when the
   * selection is too long to be a term, or when the graph is cold and the
   * question cannot be answered either way.
   *
   * Stated as a FACT rather than left to the model. Measured on qwen3:8b:
   * asked to judge for itself whether a term was defined, it invented a
   * definition out of the surrounding words — the exact failure this is here
   * to stop. A small model follows a stated fact far more reliably than it
   * evaluates a conditional instruction.
   */
  undefinedTerm: string | null
  /**
   * True when the graph was cold or the span's block was unknown to it, so
   * `related` / `headingPath` / `definedTerms` are empty for a structural
   * reason rather than because nothing relates. Callers that explain their
   * own context to the user must not present an empty list as "nothing found".
   */
  graphUnavailable: boolean
}

export interface RelatedPassage {
  blockId: string
  /** The passage itself, truncated to the per-scope budget. */
  text: string
  /** Enclosing headings for the related block — tells the model where it lives. */
  headingPath: string[]
  /** BFS hop distance from the span's block. */
  hop: number
  /**
   * Why this block is related, in a sentence a reader can act on
   * ("defines \"Retention Period\", used here"). This is what the UI shows and
   * what the model is given.
   */
  why: string
  /**
   * The same fact as machine provenance ("references → references"). Kept
   * alongside `why` rather than replaced by it: this is the audit surface, and
   * it is what a reviewer checks the human sentence against.
   */
  whyPath: string
  /** Relevance in [0,1] — see relevanceScore.ts. Above RELATED_MIN_SCORE. */
  score: number
}

/**
 * What `collectRelatedDetail` found, including what it threw away.
 *
 * The count of rejected candidates is not bookkeeping — it is the difference
 * between "this document has nothing else on the subject" and "the graph has
 * not been built yet", which an empty list alone cannot express, and which
 * decides whether the UI should say anything at all.
 */
export interface RelatedResult {
  passages: RelatedPassage[]
  /** Candidates that scored below the floor. */
  suppressed: number
  /** Candidates examined, before the floor. */
  considered: number
}

/**
 * Per-scope budgets. A phrase-level question wants a couple of tight
 * neighbours; a section-level one can afford more and longer. These are
 * deliberately small — the envelope competes with the document itself for
 * window, and recall past the first few hops is mostly noise anyway.
 */
const BUDGET: Record<Scope, { passages: number; chars: number; hops: number; invariants: number }> = {
  phrase: { passages: 3, chars: 240, hops: 2, invariants: 3 },
  sentence: { passages: 3, chars: 320, hops: 2, invariants: 3 },
  paragraph: { passages: 4, chars: 400, hops: 2, invariants: 4 },
  section: { passages: 5, chars: 480, hops: 1, invariants: 5 },
}

/** Section text cap, unchanged from the resolver's previous inline slice. */
const SECTION_CHARS = 1000

/**
 * Longest selection still treated as a "term" for the undefined-term check.
 * Beyond this the reviewer selected a passage, not a name, and "the document
 * does not define this" stops being a meaningful thing to say.
 */
const MAX_TERM_CHARS = 60

/**
 * Whether the graph says any block defines `term`.
 *
 * Compares against the SAME deterministic `definedTerms` the doc graph
 * extracts, so this can never disagree with what the graph believes. Matching
 * is case-insensitive and either-direction-containment, so selecting
 * "Retention" against a defined "Retention Period" counts as defined — a false
 * "not defined" is the costlier error, since it would have the model announce
 * an absence the reader can see is wrong.
 */
function documentDefines(graph: DocGraph, term: string): boolean {
  const needle = term.trim().toLowerCase()
  if (!needle) return true
  for (const node of graph.nodes.values()) {
    for (const defined of node.definedTerms) {
      const hay = defined.trim().toLowerCase()
      if (!hay) continue
      if (hay === needle || hay.includes(needle) || needle.includes(hay)) return true
    }
  }
  return false
}

function truncate(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`
}

/**
 * Rank neighbours by hop first, then by source precision — a block reached
 * through a deterministic cross-reference outranks one reached only through a
 * graphiti co-mention at the same distance. Mirrors the ordering
 * `getNeighborhood` already computes rather than re-deriving it.
 *
 * Exported because the pre-apply blast-radius preview answers the same
 * question ("what else does this touch?") and must rank identically — two
 * copies of this ordering would drift and quietly disagree with each other.
 */
export function collectRelatedDetail(
  graph: DocGraph,
  seedBlockId: string,
  budget: { passages: number; chars: number; hops: number; minScore?: number },
): RelatedResult {
  const minScore = budget.minScore ?? RELATED_MIN_SCORE
  const neighborhood = getNeighborhood(graph, seedBlockId, budget.hops)

  const scored: Array<{ blockId: string; hop: number; sourceRank: number; score: number; path: ReturnType<typeof findEdgePath> }> = []
  for (const [blockId, entry] of neighborhood.entries()) {
    if (blockId === seedBlockId) continue
    const node = graph.nodes.get(blockId)
    if (!node || !node.text.trim()) continue
    const path = findEdgePath(graph, seedBlockId, blockId)
    scored.push({
      blockId,
      hop: entry.hop,
      sourceRank: entry.sourceRank,
      score: scorePath(graph, seedBlockId, blockId, path, entry.hop),
      path,
    })
  }

  // Rank by SCORE, not by hop. Hop-first ordering is why a one-hop
  // co-mention outranked a two-hop passage genuinely about the same subject;
  // hop and source survive only as tie-breakers.
  const kept = scored
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score || a.hop - b.hop || a.sourceRank - b.sourceRank)
    .slice(0, budget.passages)

  const passages: RelatedPassage[] = kept.map((c) => {
    const node = graph.nodes.get(c.blockId)!
    return {
      blockId: c.blockId,
      text: truncate(node.text, budget.chars),
      headingPath: node.headingPath,
      hop: c.hop,
      score: c.score,
      why: c.path && c.path.length ? describeEdgePath(graph, c.path, seedBlockId) : 'related',
      whyPath: c.path && c.path.length ? formatEdgePath(c.path) : 'related',
    }
  })

  return {
    passages,
    suppressed: scored.length - kept.length,
    considered: scored.length,
  }
}

/**
 * Backwards-compatible view of the above: just the passages.
 *
 * Kept so existing callers and their tests are unaffected by the addition of
 * the suppressed/considered counts, which only surfaces where a UI or prompt
 * needs to distinguish "nothing relevant" from "nothing built".
 */
export function collectRelated(
  graph: DocGraph,
  seedBlockId: string,
  budget: { passages: number; chars: number; hops: number; minScore?: number },
): RelatedPassage[] {
  return collectRelatedDetail(graph, seedBlockId, budget).passages
}

/**
 * Invariants whose evidence blocks intersect the span's block or any of its
 * related blocks — i.e. facts the author declared about this neighbourhood.
 *
 * Reads only the first page of the live set. That is a deliberate, disclosed
 * degradation: the route pages by recency, so a relevant older invariant can
 * fall outside it. This layer is best-effort prompt enrichment, NOT the
 * correctness check — the exhaustive page-walk lives in the doc-CI check lane
 * (`invariantCascade.ts`), which is where a missed invariant would actually
 * matter. Failing softly here must never cost the caller its answer.
 */
async function collectInvariants(
  documentId: string,
  blockIds: Set<string>,
  cap: number,
): Promise<string[]> {
  if (!blockIds.size) return []
  try {
    const page = await listInvariants(documentId)
    const touching = page.invariants.filter((inv: Invariant) => {
      let evidence: unknown
      try {
        evidence = JSON.parse(inv.blockIds)
      } catch {
        return false
      }
      return Array.isArray(evidence) && evidence.some((id) => typeof id === 'string' && blockIds.has(id))
    })
    return touching.slice(0, cap).map((inv) => inv.statement)
  } catch {
    // Enrichment only — a failed fetch drops the layer, never the resolution.
    return []
  }
}

/**
 * Assemble the envelope for one annotation span.
 *
 * `quoteScope` overrides the scope used for budgeting. A sub-chat anchored to
 * a few words quoted out of an AI answer inherits its parent's document
 * positions but must be budgeted (and answered) at the size of ITS OWN quote,
 * not the parent's selection.
 */
export async function buildIntentContext(
  editorState: EditorState,
  pos: number,
  scope: Scope,
  quoteScope?: Scope,
  selectedText?: string,
): Promise<IntentContext> {
  const budget = BUDGET[quoteScope ?? scope] ?? BUDGET.paragraph

  const ctx: IntentContext = {
    localBlock: getBlockText(editorState, pos),
    sectionText: truncate(getSectionText(editorState, pos), SECTION_CHARS),
    headingPath: [],
    definedTerms: [],
    related: [],
    relatedSuppressed: 0,
    invariants: [],
    undefinedTerm: null,
    graphUnavailable: true,
  }

  const graph = useDocGraphStore.getState().graph
  const blockId = blockIdAtPos(editorState.doc, pos)
  if (!graph || !blockId || !graph.nodes.has(blockId)) return ctx

  ctx.graphUnavailable = false
  const seed = graph.nodes.get(blockId)
  if (seed) {
    ctx.headingPath = seed.headingPath
    ctx.definedTerms = seed.definedTerms
  }
  const relatedResult = collectRelatedDetail(graph, blockId, budget)
  ctx.related = relatedResult.passages
  ctx.relatedSuppressed = relatedResult.suppressed

  // Deterministic answer to "does this document explain this word?", computed
  // rather than asked of the model. Skipped for a long selection (a passage,
  // not a name) and impossible on a cold graph, where `graphUnavailable`
  // already tells callers not to read silence as an answer.
  const term = selectedText?.trim() ?? ''
  if (term && term.length <= MAX_TERM_CHARS && !documentDefines(graph, term)) {
    ctx.undefinedTerm = term
  }

  const documentId = useDocumentStore.getState().activeDocumentId
  if (documentId) {
    const scopeBlocks = new Set<string>([blockId, ...ctx.related.map((r) => r.blockId)])
    ctx.invariants = await collectInvariants(documentId, scopeBlocks, budget.invariants)
  }

  return ctx
}

/** One ancestor in a rabbit-hole: what was asked of what, and what came back. */
export interface BranchLink {
  /** The span this ancestor was about — its quote if it had one, else its document anchor. */
  subject: string
  question: string
  conclusion: string
}

/** How far back up a rabbit-hole to carry. Deep chains are the point, but the
 *  window is not infinite — the nearest ancestors are the ones a contradiction
 *  is most likely to be with. */
const MAX_CHAIN = 4
const CHAIN_CHARS = 200

/**
 * Walk the parentId chain and report what each ancestor concluded.
 *
 * Following a thread down is exactly where a model contradicts itself: each
 * answer is generated against its own span, so nothing structurally stops
 * level 3 from asserting the opposite of level 1. Session history makes that
 * *sometimes* visible; this makes the ancestry explicit and asks for the check
 * directly.
 *
 * Nearest ancestor first. Cycle-guarded and depth-capped: a malformed
 * parent chain must degrade to a short list, never hang the resolve.
 */
export function buildBranchChain(annotationId: string): BranchLink[] {
  const getById = useAnnotationStore.getState().getById
  const chain: BranchLink[] = []
  const seen = new Set<string>([annotationId])

  let current = getById(annotationId)?.parentId ?? null
  while (current && chain.length < MAX_CHAIN && !seen.has(current)) {
    seen.add(current)
    const ancestor = getById(current)
    if (!ancestor) break
    const conclusion = ancestor.resolution?.content?.trim()
    if (conclusion) {
      chain.push({
        subject: ancestor.sourceQuote || ancestor.anchor.text,
        question: ancestor.transcript,
        conclusion: truncate(conclusion, CHAIN_CHARS),
      })
    }
    current = ancestor.parentId
  }
  return chain
}

/**
 * Render the ancestry, with the contradiction check stated as an instruction
 * rather than left to chance. Empty chain renders to '' so a top-level
 * annotation's prompt is byte-identical to what it was before.
 */
export function formatBranchChain(chain: BranchLink[]): string {
  if (!chain.length) return ''
  const lines = ['', 'THIS QUESTION CAME OUT OF AN EARLIER ANSWER. The chain so far, nearest first:']
  for (const link of chain) {
    lines.push(`  - On "${link.subject}" you were asked: ${link.question}`)
    lines.push(`    You concluded: ${link.conclusion}`)
  }
  lines.push(
    '  If your answer here contradicts any conclusion above, say so explicitly and name which one — a quiet contradiction between two branches is worse than either answer being wrong.',
  )
  return lines.join('\n')
}

/**
 * Synchronous, allocation-cheap count of how many other blocks the graph says
 * bear on this position — for the selection popup, which must offer something
 * the instant the mouse comes up and cannot await a build or a fetch.
 *
 * Deliberately one hop, not the resolver's two: the popup is answering "is
 * there anything else to look at here", and a two-hop count inflates that into
 * a number the user cannot act on. Returns 0 whenever the graph is cold or the
 * block is unknown, which the caller must read as "don't offer it" rather than
 * "nothing is related".
 */
export function peekRelatedCount(editorState: EditorState, pos: number): number {
  const graph = useDocGraphStore.getState().graph
  if (!graph) return 0
  const blockId = blockIdAtPos(editorState.doc, pos)
  if (!blockId || !graph.nodes.has(blockId)) return 0

  // Counts only neighbours that would actually survive the relevance floor.
  // Offering "4 related passages" and then showing one (or none) is worse
  // than offering nothing: the popup is a promise about what a click will do.
  //
  // `scoreOneHopNeighbors` walks adjacency directly rather than running a BFS
  // or a path search, so this stays O(degree) on mouse-up.
  let count = 0
  for (const score of scoreOneHopNeighbors(graph, blockId).values()) {
    if (score >= RELATED_MIN_SCORE) count++
  }
  return count
}

/**
 * Render the envelope as the CONTEXT section of the resolver prompt.
 *
 * Layers that are empty are omitted rather than emitted as "none" — an empty
 * labelled heading spends tokens teaching the model nothing. The related
 * passages carry their edge path so the model can attribute what it used, and
 * so a reviewer reading the audit record can see what was in front of it.
 */
export function formatIntentContext(ctx: IntentContext): string {
  const lines: string[] = ['CONTEXT:']

  if (ctx.headingPath.length) {
    lines.push(`  Section objective: ${ctx.headingPath.join(' › ')}`)
  }
  lines.push(`  Local block: "${ctx.localBlock}"`)
  lines.push(`  Section: "${ctx.sectionText}"`)

  if (ctx.definedTerms.length) {
    lines.push(`  Terms defined here: ${ctx.definedTerms.join(', ')}`)
  }

  if (ctx.invariants.length) {
    lines.push('', 'DECLARED BY THE AUTHOR (these must remain true):')
    for (const statement of ctx.invariants) {
      lines.push(`  - ${statement}`)
    }
  }

  if (ctx.related.length) {
    lines.push('', 'RELATED PASSAGES ELSEWHERE IN THIS DOCUMENT:')
    for (const passage of ctx.related) {
      const where = passage.headingPath.length ? ` [${passage.headingPath.join(' › ')}]` : ''
      lines.push(`  - (${passage.why} · relevance ${passage.score.toFixed(2)})${where} "${passage.text}"`)
    }
    lines.push(
      '  Consider whether your answer is consistent with the passages above; cite one when it bears on the question.',
      '  Relevance is a retrieval score, not a guarantee — if a passage does not actually bear on the question, ignore it and say so.',
    )
  } else if (!ctx.graphUnavailable && ctx.relatedSuppressed > 0) {
    // Said out loud, because the alternative is saying nothing — and an
    // unexplained silence here is exactly what a model fills with "as
    // discussed in Section 8".
    lines.push(
      '',
      `NOTHING ELSE IN THIS DOCUMENT BEARS ON THIS SPAN. (${ctx.relatedSuppressed} candidate passage${ctx.relatedSuppressed === 1 ? ' was' : 's were'} checked and rejected as unrelated.)`,
      '  Do not invent a cross-reference to another section.',
    )
  }

  // Last, because on a small model the nearest instruction wins: burying this
  // among the system rules let the type prompt ("2-3 key insights, bullets")
  // override it, and the model answered "what is Atlantis?" by inventing a
  // definition out of the neighbouring words.
  if (ctx.undefinedTerm) {
    lines.push(
      '',
      `THIS DOCUMENT DOES NOT DEFINE "${ctx.undefinedTerm}". It names the term without explaining it.`,
      `Begin your answer with: This document does not define "${ctx.undefinedTerm}".`,
      'Then, under a line reading "From outside the document:", explain what it is from your own',
      'knowledge. Do NOT construct a definition out of the surrounding sentences — the words next to',
      'a term are not its meaning.',
      'If the name has several meanings, pick the one that fits the subject matter above and say',
      'which sense you mean. If you are not confident the term means something specific in this',
      'field, say that outright instead of guessing — an admitted gap is useful, a wrong gloss is not.',
    )
  }

  return lines.join('\n')
}
