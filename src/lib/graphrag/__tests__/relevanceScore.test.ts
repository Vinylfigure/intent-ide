import { describe, it, expect } from 'vitest'
import type { DocGraph, DocGraphEdge, DocGraphNode } from '../docGraph'
import {
  CORROB_FLOOR,
  HOP_DECAY,
  RELATED_MIN_SCORE,
  SOURCE_CONFIDENCE,
  edgeConfidence,
  isSelfJustifying,
  lexicalOverlap,
  scoreOneHopNeighbors,
  scorePath,
} from '../relevanceScore'

// The scorer decides whether a passage is shown to a human at all, so the
// cases below are written as the questions a reader would ask: "why is THIS
// here?" Each one corresponds to a false positive the old top-N-by-hop
// retrieval actually produced.

function graphOf(
  blocks: Array<{ id: string; text: string }>,
  edges: DocGraphEdge[] = [],
): DocGraph {
  const nodes = new Map<string, DocGraphNode>()
  for (const b of blocks) {
    nodes.set(b.id, {
      blockId: b.id,
      pos: 0,
      nodeType: 'paragraph',
      text: b.text,
      headingPath: [],
      definedTerms: [],
    })
  }
  const adjacency = new Map<string, DocGraphEdge[]>()
  for (const e of edges) {
    if (!adjacency.has(e.from)) adjacency.set(e.from, [])
    if (!adjacency.has(e.to)) adjacency.set(e.to, [])
    adjacency.get(e.from)!.push(e)
    adjacency.get(e.to)!.push(e)
  }
  return {
    contentHash: 'h',
    builtAt: 0,
    llmApplied: false,
    llmPartial: false,
    embeddingsApplied: false,
    embeddingsPartial: false,
    graphitiApplied: false,
    graphitiEpisodeGen: -1,
    blockHashes: new Map(),
    nodes,
    edges,
    adjacency,
  }
}

const edge = (from: string, to: string, over: Partial<DocGraphEdge> = {}): DocGraphEdge => ({
  from,
  to,
  type: 'references',
  source: 'deterministic',
  ...over,
})

// Two passages about genuinely different things, sharing only filler words.
const UNRELATED = [
  { id: 'a', text: 'Jira and Splunk access grant reconciliation matched approval tickets nightly.' },
  { id: 'b', text: 'Second pass learning: study payments and PCI scoping before Thursday.' },
]

// Two passages about the same subsystem, sharing rare vocabulary.
const RELATED = [
  { id: 'a', text: 'Jira and Splunk access grant reconciliation matched approval tickets nightly.' },
  { id: 'b', text: 'Grant reconciliation surfaced Splunk account naming inconsistencies in Jira.' },
]

describe('edgeConfidence', () => {
  it('uses the edge weight when it has one', () => {
    expect(edgeConfidence(edge('a', 'b', { weight: 0.4 }))).toBe(0.4)
  })

  it('falls back to the source default when it does not', () => {
    expect(edgeConfidence(edge('a', 'b'))).toBe(SOURCE_CONFIDENCE.deterministic)
    expect(edgeConfidence(edge('a', 'b', { source: 'graphiti' }))).toBe(SOURCE_CONFIDENCE.graphiti)
  })

  it('clamps a nonsense weight instead of propagating it', () => {
    expect(edgeConfidence(edge('a', 'b', { weight: 5 }))).toBe(1)
    expect(edgeConfidence(edge('a', 'b', { weight: -3 }))).toBe(0)
    expect(edgeConfidence(edge('a', 'b', { weight: Number.NaN }))).toBe(SOURCE_CONFIDENCE.deterministic)
  })
})

describe('isSelfJustifying', () => {
  it('trusts a link the author actually wrote', () => {
    expect(isSelfJustifying(edge('a', 'b', { kind: 'named-ref' }))).toBe(true)
    expect(isSelfJustifying(edge('a', 'b', { kind: 'section-number' }))).toBe(true)
    expect(isSelfJustifying(edge('a', 'b', { kind: 'verbatim' }))).toBe(true)
  })

  it('does not trust the positional-index guess', () => {
    // `section-ordinal` is this codebase guessing that "Section 8" means the
    // eighth heading. Deterministic, but not evidence.
    expect(isSelfJustifying(edge('a', 'b', { kind: 'section-ordinal', weight: 0.6 }))).toBe(false)
  })

  it('trusts a term used in a few places but not one used everywhere', () => {
    expect(isSelfJustifying(edge('a', 'b', { kind: 'defined-term', weight: 0.95 }))).toBe(true)
    // df=5 → 0.63, below TERM_SELF_JUSTIFY.
    expect(isSelfJustifying(edge('a', 'b', { kind: 'defined-term', weight: 0.63 }))).toBe(false)
  })

  it('never trusts a bare entity co-mention', () => {
    expect(isSelfJustifying(edge('a', 'b', { source: 'graphiti', evidence: 'Aegis' }))).toBe(false)
  })

  it('trusts an LLM edge only when it cited something', () => {
    expect(isSelfJustifying(edge('a', 'b', { source: 'llm', evidence: 'the grant window' }))).toBe(true)
    expect(isSelfJustifying(edge('a', 'b', { source: 'llm' }))).toBe(false)
  })

  it('treats an edge with no kind as self-justifying', () => {
    // Legacy and hand-built graphs predate `kind`. Failing them all would be a
    // far worse regression than being slightly permissive on data this module
    // did not build.
    expect(isSelfJustifying(edge('a', 'b'))).toBe(true)
  })
})

describe('lexicalOverlap — IDF weighting', () => {
  it('gives a token present in every block almost no weight', () => {
    // "Aegis" everywhere is exactly the hub term that made the whole document
    // look self-related.
    // Each block shares the hub word and nothing else: its own rare terms
    // carry all the real information.
    const blocks = Array.from({ length: 10 }, (_, i) => ({
      id: `b${i}`,
      text: `Aegis governs zulu${i} quorum${i} lattice${i} beacon${i} harbor${i}.`,
    }))
    const graph = graphOf(blocks)
    expect(lexicalOverlap(graph, 'b0', 'b5')).toBeLessThan(0.15)
  })

  it('scores two passages sharing rare vocabulary highly', () => {
    const graph = graphOf(RELATED)
    expect(lexicalOverlap(graph, 'a', 'b')).toBeGreaterThan(0.15)
  })

  it('is symmetric', () => {
    const graph = graphOf(RELATED)
    expect(lexicalOverlap(graph, 'a', 'b')).toBeCloseTo(lexicalOverlap(graph, 'b', 'a'), 10)
  })

  it('returns 0 for an unknown or empty block rather than throwing', () => {
    const graph = graphOf([...RELATED, { id: 'empty', text: '' }])
    expect(lexicalOverlap(graph, 'a', 'nope')).toBe(0)
    expect(lexicalOverlap(graph, 'a', 'empty')).toBe(0)
  })
})

describe('scorePath', () => {
  it('clears the floor for a one-hop link the author wrote, with no shared words', () => {
    const graph = graphOf(UNRELATED, [edge('a', 'b', { kind: 'named-ref', weight: 0.95 })])
    const score = scorePath(graph, 'a', 'b', graph.edges, 1)
    expect(score).toBeGreaterThan(RELATED_MIN_SCORE)
  })

  it('gates EVERY two-hop path on shared vocabulary, however strong the steps', () => {
    // The reported label: `references ("Sections 8") → references ("Aegis")`.
    // Two hops is transitive inference, never evidence.
    const path = [edge('a', 'm', { kind: 'named-ref', weight: 0.95 }), edge('m', 'b', { kind: 'named-ref', weight: 0.95 })]
    const unrelated = graphOf(UNRELATED, path)
    const related = graphOf(RELATED, path)
    expect(scorePath(unrelated, 'a', 'b', path, 2)).toBeLessThan(RELATED_MIN_SCORE)
    expect(scorePath(related, 'a', 'b', path, 2)).toBeGreaterThan(RELATED_MIN_SCORE)
  })

  it('drops a hub-term link between passages with nothing else in common', () => {
    // df=5 → weight 0.63, under TERM_SELF_JUSTIFY, so it must corroborate.
    const e = edge('a', 'b', { kind: 'defined-term', weight: 0.63 })
    const graph = graphOf(UNRELATED, [e])
    expect(scorePath(graph, 'a', 'b', [e], 1)).toBeLessThan(RELATED_MIN_SCORE)
  })

  it('keeps a hub-term link when the passages really are about the same thing', () => {
    const e = edge('a', 'b', { kind: 'defined-term', weight: 0.63 })
    const graph = graphOf(RELATED, [e])
    expect(scorePath(graph, 'a', 'b', [e], 1)).toBeGreaterThan(RELATED_MIN_SCORE)
  })

  it('never lets a bare entity co-mention clear the floor on its own', () => {
    // 0.45 × CORROB_FLOOR = 0.2475, under the 0.30 cut-off.
    const e = edge('a', 'b', { source: 'graphiti', evidence: 'Aegis' })
    const graph = graphOf(UNRELATED, [e])
    expect(scorePath(graph, 'a', 'b', [e], 1)).toBeCloseTo(SOURCE_CONFIDENCE.graphiti * CORROB_FLOOR, 5)
    expect(scorePath(graph, 'a', 'b', [e], 1)).toBeLessThan(RELATED_MIN_SCORE)
  })

  it('decays with distance', () => {
    const e = edge('a', 'b', { kind: 'named-ref', weight: 0.95 })
    const graph = graphOf(RELATED, [e])
    const near = scorePath(graph, 'a', 'b', [e], 1)
    const far = scorePath(graph, 'a', 'b', [e], 3)
    expect(far).toBeLessThan(near)
    // Two extra hops, two applications of the decay. (Corroboration is 1 at
    // hop 1 for a self-justifying edge and 1 again here, since these two
    // passages do share rare vocabulary — so only the decay differs.)
    expect(far / near).toBeCloseTo(Math.pow(HOP_DECAY, 2), 5)
  })

  it('treats an uninspectable path as the weakest possible link', () => {
    // A null path means the graph connects them by a route the scorer cannot
    // examine. Trusting that would reintroduce the original bug.
    const graph = graphOf(UNRELATED)
    expect(scorePath(graph, 'a', 'b', null, 1)).toBeLessThan(RELATED_MIN_SCORE)
  })
})

describe('scoreOneHopNeighbors — the mouse-up fast path', () => {
  it('agrees with scorePath for direct neighbours', () => {
    const e = edge('a', 'b', { kind: 'named-ref', weight: 0.95 })
    const graph = graphOf(RELATED, [e])
    expect(scoreOneHopNeighbors(graph, 'a').get('b')).toBeCloseTo(scorePath(graph, 'a', 'b', [e], 1), 10)
  })

  it('takes the best edge when several connect the same pair', () => {
    const weak = edge('a', 'b', { source: 'graphiti', evidence: 'Aegis' })
    const strong = edge('a', 'b', { kind: 'named-ref', weight: 0.95 })
    const graph = graphOf(UNRELATED, [weak, strong])
    expect(scoreOneHopNeighbors(graph, 'a').get('b')).toBeCloseTo(
      scorePath(graph, 'a', 'b', [strong], 1),
      10,
    )
  })

  it('walks edges in both directions', () => {
    const e = edge('b', 'a', { kind: 'named-ref', weight: 0.95 })
    const graph = graphOf(RELATED, [e])
    expect(scoreOneHopNeighbors(graph, 'a').has('b')).toBe(true)
  })

  it('returns nothing for an isolated block', () => {
    expect(scoreOneHopNeighbors(graphOf(UNRELATED), 'a').size).toBe(0)
  })
})
