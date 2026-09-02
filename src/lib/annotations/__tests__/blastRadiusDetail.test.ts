// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { EditorState } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'
import { useDocGraphStore } from '@/stores/docGraphStore'
import type { DocGraph, DocGraphEdge, DocGraphNode } from '@/lib/graphrag/docGraph'
import { previewBlastRadius, previewBlastRadiusDetail } from '../blastRadius'

// The "Touches N other passages" card. Its three states are NOT
// interchangeable: "nothing depends on this" is a claim about the document,
// and making it on the strength of an unbuilt index would be a false
// statement rather than a cautious one.

function p(blockId: string, text: string): PMNode {
  return schema.node('paragraph', { blockId }, [schema.text(text)])
}

const SEED = 'Jira and Splunk access grant reconciliation matched approval tickets nightly.'
const OFF_TOPIC = 'Second pass learning: study payments and PCI scoping before Thursday.'
const ON_TOPIC = 'Grant reconciliation surfaced Splunk account naming inconsistencies in Jira.'

function graphOf(blocks: Array<[string, string]>, edges: DocGraphEdge[]): DocGraph {
  const nodes = new Map<string, DocGraphNode>()
  for (const [id, text] of blocks) {
    nodes.set(id, { blockId: id, pos: 0, nodeType: 'paragraph', text, headingPath: [], definedTerms: [] })
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

const hub = (from: string, to: string): DocGraphEdge => ({
  from, to, type: 'references', source: 'deterministic', evidence: 'Aegis', kind: 'defined-term', weight: 0.63,
})
const authored = (from: string, to: string): DocGraphEdge => ({
  from, to, type: 'references', source: 'deterministic', evidence: 'Grant reconciliation', kind: 'named-ref', weight: 0.95,
})

function state(): EditorState {
  return EditorState.create({ schema, doc: schema.node('doc', null, [p('a', SEED)]) })
}

beforeEach(() => {
  useDocGraphStore.setState({ graph: null })
})

describe('previewBlastRadiusDetail — the three states', () => {
  it('reports graphUnavailable on a cold graph', () => {
    expect(previewBlastRadiusDetail(state(), 1)).toEqual({
      passages: [],
      suppressed: 0,
      graphUnavailable: true,
    })
  })

  it('reports graphUnavailable when the block is unknown to the graph', () => {
    useDocGraphStore.setState({ graph: graphOf([['zzz', SEED]], []) })
    expect(previewBlastRadiusDetail(state(), 1).graphUnavailable).toBe(true)
  })

  it('reports rejected candidates so the card can say nothing depends on this', () => {
    useDocGraphStore.setState({
      graph: graphOf([['a', SEED], ['b', OFF_TOPIC], ['c', OFF_TOPIC]], [hub('b', 'a'), hub('c', 'a')]),
    })
    expect(previewBlastRadiusDetail(state(), 1)).toMatchObject({
      passages: [],
      suppressed: 2,
      graphUnavailable: false,
    })
  })

  it('reports a genuinely related passage', () => {
    useDocGraphStore.setState({ graph: graphOf([['a', SEED], ['b', ON_TOPIC]], [authored('a', 'b')]) })
    const result = previewBlastRadiusDetail(state(), 1)
    expect(result.passages).toHaveLength(1)
    expect(result.graphUnavailable).toBe(false)
  })

  it('distinguishes "checked and found nothing" from "nothing to check"', () => {
    useDocGraphStore.setState({ graph: graphOf([['a', SEED]], []) })
    expect(previewBlastRadiusDetail(state(), 1)).toMatchObject({ suppressed: 0, graphUnavailable: false })
  })
})

describe('previewBlastRadius — compatibility', () => {
  it('returns exactly the detail view\'s passages', () => {
    useDocGraphStore.setState({ graph: graphOf([['a', SEED], ['b', ON_TOPIC]], [authored('a', 'b')]) })
    expect(previewBlastRadius(state(), 1)).toEqual(previewBlastRadiusDetail(state(), 1).passages)
  })

  it('is still empty on a cold graph', () => {
    expect(previewBlastRadius(state(), 1)).toEqual([])
  })
})
