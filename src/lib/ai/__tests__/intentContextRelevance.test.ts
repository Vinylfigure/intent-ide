// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { EditorState } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'
import { useDocGraphStore } from '@/stores/docGraphStore'
import type { DocGraph, DocGraphEdge, DocGraphNode } from '@/lib/graphrag/docGraph'
import {
  collectRelatedDetail,
  formatIntentContext,
  peekRelatedCount,
  type IntentContext,
} from '../intentContext'

// The reported symptom, stated as a test: a passage about "Jira + Splunk
// access-grant reconciliation" surfaced two passages about study sections and
// an Aegis checklist, because retrieval returned the top N neighbours and there
// were exactly N neighbours. These cover the floor that stops that, and the
// three states an empty result can now mean.

const SEED = 'Jira and Splunk access grant reconciliation matched approval tickets nightly.'
const ON_TOPIC = 'Grant reconciliation surfaced Splunk account naming inconsistencies in Jira.'
const OFF_TOPIC_1 = 'Second pass learning: study payments and PCI scoping before Thursday.'
const OFF_TOPIC_2 = 'Interview day one page mental checklist covering design judgement claims.'

function nodeOf(blockId: string, text: string): DocGraphNode {
  return { blockId, pos: 0, nodeType: 'paragraph', text, headingPath: [], definedTerms: [] }
}

function graphOf(blocks: Array<[string, string]>, edges: DocGraphEdge[]): DocGraph {
  const nodes = new Map<string, DocGraphNode>()
  for (const [id, text] of blocks) nodes.set(id, nodeOf(id, text))
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

const hubEdge = (from: string, to: string): DocGraphEdge => ({
  from,
  to,
  type: 'references',
  source: 'deterministic',
  evidence: 'Aegis',
  kind: 'defined-term',
  // df=5 — a project-wide noun, below TERM_SELF_JUSTIFY.
  weight: 0.63,
})

const authoredEdge = (from: string, to: string): DocGraphEdge => ({
  from,
  to,
  type: 'references',
  source: 'deterministic',
  evidence: 'Grant reconciliation',
  kind: 'named-ref',
  weight: 0.95,
})

const BUDGET = { passages: 4, chars: 400, hops: 2 }

function stateWith(text: string): EditorState {
  const block: PMNode = schema.node('paragraph', { blockId: 'a' }, [schema.text(text)])
  return EditorState.create({ schema, doc: schema.node('doc', null, [block]) })
}

beforeEach(() => {
  useDocGraphStore.setState({ graph: null })
})

describe('collectRelatedDetail — the relevance floor', () => {
  it('drops candidates that only share a hub term, and counts them', () => {
    const graph = graphOf(
      [['a', SEED], ['b', OFF_TOPIC_1], ['c', OFF_TOPIC_2]],
      [hubEdge('b', 'a'), hubEdge('c', 'a')],
    )
    const result = collectRelatedDetail(graph, 'a', BUDGET)
    expect(result.passages).toEqual([])
    expect(result.suppressed).toBe(2)
    expect(result.considered).toBe(2)
  })

  it('keeps a passage the author actually cross-referenced', () => {
    const graph = graphOf([['a', SEED], ['b', ON_TOPIC]], [authoredEdge('a', 'b')])
    const result = collectRelatedDetail(graph, 'a', BUDGET)
    expect(result.passages.map((p) => p.blockId)).toEqual(['b'])
    expect(result.suppressed).toBe(0)
  })

  it('keeps a hub-term link when the passages really are about the same thing', () => {
    const graph = graphOf([['a', SEED], ['b', ON_TOPIC]], [hubEdge('b', 'a')])
    expect(collectRelatedDetail(graph, 'a', BUDGET).passages).toHaveLength(1)
  })

  it('ranks by score, not by hop', () => {
    // The old ordering put every one-hop neighbour ahead of every two-hop one,
    // so a weak-but-near passage outranked a strong-and-far one.
    const graph = graphOf(
      [['a', SEED], ['near', OFF_TOPIC_1], ['mid', ON_TOPIC], ['far', ON_TOPIC]],
      [hubEdge('near', 'a'), authoredEdge('a', 'mid'), authoredEdge('mid', 'far')],
    )
    const ids = collectRelatedDetail(graph, 'a', BUDGET).passages.map((p) => p.blockId)
    expect(ids).not.toContain('near')
    expect(ids[0]).toBe('mid')
  })

  it('respects the passage budget', () => {
    const blocks: Array<[string, string]> = [['a', SEED]]
    const edges: DocGraphEdge[] = []
    for (let i = 0; i < 8; i++) {
      blocks.push([`b${i}`, ON_TOPIC])
      edges.push(authoredEdge('a', `b${i}`))
    }
    const result = collectRelatedDetail(graphOf(blocks, edges), 'a', { ...BUDGET, passages: 3 })
    expect(result.passages).toHaveLength(3)
  })

  it('reports zero considered when the seed has no neighbours at all', () => {
    // Distinct from "candidates were rejected" — the UI says different things.
    const result = collectRelatedDetail(graphOf([['a', SEED]], []), 'a', BUDGET)
    expect(result).toMatchObject({ passages: [], suppressed: 0, considered: 0 })
  })

  it('carries both a human sentence and the machine path', () => {
    const graph = graphOf([['a', SEED], ['b', ON_TOPIC]], [authoredEdge('a', 'b')])
    const [passage] = collectRelatedDetail(graph, 'a', BUDGET).passages
    // What a reader sees...
    expect(passage.why).toContain('cross-referenced as')
    expect(passage.why).not.toContain('references (')
    // ...and what an auditor checks it against, unchanged.
    expect(passage.whyPath).toBe('references ("Grant reconciliation")')
    expect(passage.score).toBeGreaterThan(0)
  })
})

describe('peekRelatedCount — the mouse-up offer', () => {
  it('counts only neighbours that would survive the floor', () => {
    // Offering "3 related passages" and then showing none is worse than
    // offering nothing — the popup is a promise about what a click will do.
    useDocGraphStore.setState({
      graph: graphOf(
        [['a', SEED], ['b', OFF_TOPIC_1], ['c', OFF_TOPIC_2], ['d', ON_TOPIC]],
        [hubEdge('b', 'a'), hubEdge('c', 'a'), authoredEdge('a', 'd')],
      ),
    })
    expect(peekRelatedCount(stateWith(SEED), 1)).toBe(1)
  })

  it('returns 0 on a cold graph rather than guessing', () => {
    useDocGraphStore.setState({ graph: null })
    expect(peekRelatedCount(stateWith(SEED), 1)).toBe(0)
  })

  it('returns 0 for a block the graph has never seen', () => {
    useDocGraphStore.setState({ graph: graphOf([['zzz', SEED]], []) })
    expect(peekRelatedCount(stateWith(SEED), 1)).toBe(0)
  })
})

describe('formatIntentContext — the three meanings of an empty list', () => {
  const base: IntentContext = {
    localBlock: SEED,
    sectionText: SEED,
    headingPath: [],
    definedTerms: [],
    related: [],
    relatedSuppressed: 0,
    invariants: [],
    undefinedTerm: null,
    graphUnavailable: false,
  }

  it('says nothing when the graph is cold — an unbuilt index is not evidence of absence', () => {
    const out = formatIntentContext({ ...base, graphUnavailable: true, relatedSuppressed: 0 })
    expect(out).not.toContain('NOTHING ELSE IN THIS DOCUMENT')
  })

  it('says nothing when there were simply no candidates', () => {
    expect(formatIntentContext(base)).not.toContain('NOTHING ELSE IN THIS DOCUMENT')
  })

  it('states the absence when candidates were checked and rejected', () => {
    const out = formatIntentContext({ ...base, relatedSuppressed: 2 })
    expect(out).toContain('NOTHING ELSE IN THIS DOCUMENT BEARS ON THIS SPAN')
    expect(out).toContain('2 candidate passages were checked')
    expect(out).toContain('Do not invent a cross-reference')
  })

  it('uses the singular for a single rejected candidate', () => {
    expect(formatIntentContext({ ...base, relatedSuppressed: 1 })).toContain('1 candidate passage was checked')
  })

  it('renders the human sentence and the score, not the raw edge path', () => {
    const out = formatIntentContext({
      ...base,
      related: [
        {
          blockId: 'b',
          text: ON_TOPIC,
          headingPath: ['Anchor stories'],
          hop: 1,
          score: 0.91,
          why: 'defines "Grant reconciliation", used here',
          whyPath: 'references ("Grant reconciliation")',
        },
      ],
    })
    expect(out).toContain('defines "Grant reconciliation", used here')
    expect(out).toContain('relevance 0.91')
    expect(out).not.toContain('references (')
  })

  it('tells the model a retrieval score is not a guarantee', () => {
    const out = formatIntentContext({
      ...base,
      related: [
        { blockId: 'b', text: ON_TOPIC, headingPath: [], hop: 1, score: 0.5, why: 'x', whyPath: 'y' },
      ],
    })
    expect(out).toContain('not a guarantee')
  })
})
