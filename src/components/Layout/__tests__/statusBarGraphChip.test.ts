import { describe, expect, it } from 'vitest'
import { graphChip } from '@/components/Layout/StatusBar'

const ready = { llmApplied: false, llmPartial: false, embeddingsPartial: false }

describe('graphChip', () => {
  it('reports a cold graph instead of rendering nothing', () => {
    // Regression: this returned null, so "the section map was never built"
    // looked exactly like "there is no chip for this" — which is why every
    // consumer silently degrading to empty went unnoticed for so long.
    const chip = graphChip('idle', null)
    expect(chip).not.toBeNull()
    expect(chip?.label).toBe('graph: not built')
    expect(chip?.title).toMatch(/unavailable/i)
  })

  it('still prefers the building state over the cold state', () => {
    expect(graphChip('building', null)?.label).toBe('graph: building…')
  })

  it('reports a deterministic-only graph', () => {
    expect(graphChip('ready', ready)?.label).toBe('graph: rules only')
  })

  it('reports an LLM-enriched graph', () => {
    expect(graphChip('ready', { ...ready, llmApplied: true })?.label).toBe('graph: enriched')
  })

  it('marks partial coverage, so missing connections are not read as absent ones', () => {
    expect(graphChip('ready', { ...ready, llmPartial: true })?.label).toContain('+partial')
    expect(graphChip('ready', { ...ready, embeddingsPartial: true })?.label).toContain('+partial')
  })
})
