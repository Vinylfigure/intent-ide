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

  it('reports the background enrichment pass — usable graph already published, just improving', () => {
    const chip = graphChip('enriching', ready)
    expect(chip?.label).toBe('graph: linking meaning…')
    expect(chip?.title).toMatch(/already usable/i)
  })

  it('prefers the enriching state even when a ready graph is already present', () => {
    // 'enriching' publishes ALONGSIDE an already-ready graph — must never be
    // read as "no usable graph", the way 'building' with graph=null is.
    expect(graphChip('enriching', { ...ready, llmApplied: true })?.label).toBe(
      'graph: linking meaning…',
    )
  })

  it('reports rules + meaning once the idle embedding pass has applied, short of full LLM enrichment', () => {
    expect(graphChip('ready', { ...ready, embeddingsApplied: true })?.label).toBe(
      'graph: rules + meaning',
    )
  })

  it('llmApplied still wins over embeddingsApplied — "enriched" is the strictly stronger state', () => {
    expect(
      graphChip('ready', { ...ready, embeddingsApplied: true, llmApplied: true })?.label,
    ).toBe('graph: enriched')
  })

  it('names why meaning-based connections are missing when a reason is supplied', () => {
    const chip = graphChip('ready', ready, 'This provider has no embeddings API.')
    expect(chip?.label).toBe('graph: rules only') // label unchanged
    expect(chip?.title).toContain('This provider has no embeddings API.')
  })

  it('omits the reason clause entirely when none is supplied (existing literal still typechecks)', () => {
    const chip = graphChip('ready', ready)
    expect(chip?.label).toBe('graph: rules only')
    expect(chip?.title).not.toContain('undefined')
  })
})
