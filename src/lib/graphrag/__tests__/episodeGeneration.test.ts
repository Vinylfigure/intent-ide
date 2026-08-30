import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'
import type { LLMConfig } from '@/stores/settingsStore'
import type { Annotation } from '@/lib/annotations/types'

const addEpisode = vi.fn()
const searchNodes = vi.fn()
const getSubgraph = vi.fn()
vi.mock('@/lib/mcp/graphitiClient', () => ({
  addEpisode: (...args: unknown[]) => addEpisode(...args),
  searchNodes: (...args: unknown[]) => searchNodes(...args),
  getSubgraph: (...args: unknown[]) => getSubgraph(...args),
}))

import {
  ingestAnnotationEpisode,
  ingestEditEpisode,
  getEpisodeGeneration,
  resetEpisodeGeneration,
} from '../episodeIngestion'
import { getDocGraph, invalidateDocGraphCache } from '../docGraph'

const CONFIG: LLMConfig = { provider: 'claude', apiKey: 'test-key', model: 'test-model' }

function p(blockId: string, text: string): PMNode {
  return schema.node('paragraph', { blockId }, [schema.text(text)])
}

function docOf(...blocks: PMNode[]): PMNode {
  return schema.node('doc', null, blocks)
}

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    documentId: 'doc-1',
    locationGroupKey: 'doc-1:1:10',
    type: 'edit',
    status: 'resolved',
    transcript: 'say something',
    anchor: { from: 0, to: 1, scope: 'sentence', text: 'x' },
    resolution: { type: 'edit', content: 'done', suggestedEdit: null, actions: [] },
    conversation: [],
    parentId: null,
    childIds: [],
    createdAt: 100,
    resolvedAt: 200,
    verbosity: 'concise',
    ...overrides,
  }
}

beforeEach(() => {
  resetEpisodeGeneration()
  invalidateDocGraphCache()
  addEpisode.mockReset()
  searchNodes.mockReset().mockResolvedValue([])
  getSubgraph.mockReset().mockResolvedValue({ nodes: [], edges: [] })
})

describe('episodeIngestion generation counter', () => {
  it('starts at 0 and never moves on its own', () => {
    expect(getEpisodeGeneration()).toBe(0)
  })

  it('bumps once per successful ingestAnnotationEpisode call', async () => {
    addEpisode.mockResolvedValue({ success: true })
    await ingestAnnotationEpisode(annotation())
    expect(getEpisodeGeneration()).toBe(1)
    await ingestAnnotationEpisode(annotation({ id: 'a2' }))
    expect(getEpisodeGeneration()).toBe(2)
  })

  it('bumps once per successful ingestEditEpisode call', async () => {
    addEpisode.mockResolvedValue({ success: true })
    await ingestEditEpisode('a1', 'before', 'after', 'desc')
    expect(getEpisodeGeneration()).toBe(1)
  })

  it('does NOT bump when addEpisode throws (MCP unreachable)', async () => {
    addEpisode.mockRejectedValue(new Error('ECONNREFUSED'))
    const ok = await ingestAnnotationEpisode(annotation())
    expect(ok).toBe(false)
    expect(getEpisodeGeneration()).toBe(0)
  })

  it('does NOT bump when the annotation has no resolution (never calls addEpisode)', async () => {
    const ok = await ingestAnnotationEpisode(annotation({ resolution: null }))
    expect(ok).toBe(false)
    expect(addEpisode).not.toHaveBeenCalled()
    expect(getEpisodeGeneration()).toBe(0)
  })
})

describe('getDocGraph — real wiring, no deps.graphiti test override', () => {
  // The other Graphiti-retry tests (docGraph.test.ts) inject episodeGeneration
  // directly via deps.graphiti — deliberate, but it means no test exercises
  // the actual production path: getDocGraph called with no override at all,
  // reading getEpisodeGeneration() itself, fed by a REAL ingestAnnotationEpisode
  // call (only the MCP client's addEpisode/searchNodes/getSubgraph are mocked).
  it('retries the real Graphiti pass after a real ingested episode bumps the module counter', async () => {
    const doc = docOf(p('b1', 'Alpha Term here.'), p('b2', 'Alpha Term there.'))
    const deps = { skipLlm: true, embeddingsEnabled: false }

    const g1 = await getDocGraph(doc, CONFIG, deps)
    expect(searchNodes).toHaveBeenCalledTimes(1)
    expect(g1.graphitiEpisodeGen).toBe(0) // real counter starts at 0

    // Same generation, same content hash: no redundant MCP call.
    await getDocGraph(doc, CONFIG, deps)
    expect(searchNodes).toHaveBeenCalledTimes(1)

    // A real annotation resolution ingests an episode — bumps the REAL counter.
    addEpisode.mockResolvedValue({ success: true })
    await ingestAnnotationEpisode(annotation())
    expect(getEpisodeGeneration()).toBe(1)

    // Next getDocGraph call, still with no DI override, picks up the retry
    // purely through the real getEpisodeGeneration() wiring.
    const g2 = await getDocGraph(doc, CONFIG, deps)
    expect(searchNodes).toHaveBeenCalledTimes(2)
    expect(g2.graphitiEpisodeGen).toBe(1)
  })
})
