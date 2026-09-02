// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { EditorState } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'
import { useDocGraphStore } from '@/stores/docGraphStore'
import type { DocGraph, DocGraphEdge, DocGraphNode } from '@/lib/graphrag/docGraph'
import { previewBlastRadius } from '../blastRadius'

function p(blockId: string, text: string): PMNode {
  return schema.node('paragraph', { blockId }, [schema.text(text)])
}

function docOf(...blocks: PMNode[]): PMNode {
  return schema.node('doc', null, blocks)
}

function state(doc: PMNode): EditorState {
  return EditorState.create({ schema, doc })
}

/** Hand-built graph: seed 'a' has two neighbours, 'b' at hop 1 and 'c' at hop 2. */
function chainGraph(): DocGraph {
  const node = (blockId: string, text: string): DocGraphNode => ({
    blockId,
    pos: 0,
    nodeType: 'paragraph',
    text,
    headingPath: [],
    definedTerms: [],
  })
  const nodes = new Map<string, DocGraphNode>([
    ['a', node('a', 'Alpha block')],
    ['b', node('b', 'Beta block')],
    ['c', node('c', 'Gamma block')],
  ])
  const ab: DocGraphEdge = { from: 'a', to: 'b', type: 'references', source: 'deterministic' }
  const bc: DocGraphEdge = { from: 'b', to: 'c', type: 'references', source: 'deterministic' }
  const adjacency = new Map<string, DocGraphEdge[]>([
    ['a', [ab]],
    ['b', [ab, bc]],
    ['c', [bc]],
  ])
  return {
    contentHash: 'test-hash',
    builtAt: 0,
    llmApplied: false,
    llmPartial: false,
    embeddingsApplied: false,
    embeddingsPartial: false,
    graphitiApplied: false,
    blockHashes: new Map(),
    nodes,
    edges: [ab, bc],
    adjacency,
  }
}

beforeEach(() => {
  useDocGraphStore.setState({ graph: null, status: 'idle', lastSeq: 0 })
})

describe('previewBlastRadius', () => {
  it('returns [] when the graph is cold', () => {
    const doc = docOf(p('a', 'Alpha block'))
    expect(previewBlastRadius(state(doc), 1)).toEqual([])
  })

  it('returns [] when the position\'s block id is unknown to the graph', () => {
    useDocGraphStore.setState({ graph: chainGraph(), status: 'ready', lastSeq: 1 })
    const doc = docOf(p('unknown-block', 'Not in the graph'))
    expect(previewBlastRadius(state(doc), 1)).toEqual([])
  })

  it('returns neighbours nearest-hop-first, capped, for a seed block in the graph', () => {
    useDocGraphStore.setState({ graph: chainGraph(), status: 'ready', lastSeq: 1 })
    const doc = docOf(p('a', 'Alpha block'))
    const result = previewBlastRadius(state(doc), 1)
    expect(result.map((r) => r.blockId)).toEqual(['b', 'c'])
    expect(result[0].hop).toBe(1)
    expect(result[1].hop).toBe(2)
  })

  it('caps the returned passages', () => {
    useDocGraphStore.setState({ graph: chainGraph(), status: 'ready', lastSeq: 1 })
    const doc = docOf(p('a', 'Alpha block'))
    const result = previewBlastRadius(state(doc), 1, 1)
    expect(result.length).toBe(1)
    expect(result[0].blockId).toBe('b')
  })
})
