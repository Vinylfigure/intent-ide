import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Annotation } from '@/lib/annotations/types'

const addEpisode = vi.fn()
vi.mock('@/lib/mcp/graphitiClient', () => ({
  addEpisode: (...args: unknown[]) => addEpisode(...args),
}))

import {
  ingestAnnotationEpisode,
  ingestEditEpisode,
  getEpisodeGeneration,
  resetEpisodeGeneration,
} from '../episodeIngestion'

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
  addEpisode.mockReset()
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
