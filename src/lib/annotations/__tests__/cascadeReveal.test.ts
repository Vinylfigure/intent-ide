import { describe, it, expect } from 'vitest'
import { schema } from '@/lib/prosemirror/schema'
import { partitionCascadeReveal, cascadeBreakpointPos } from '../cascadeReveal'
import type { ProposedEdit } from '../types'

function edit(overrides: Partial<ProposedEdit>): ProposedEdit {
  return {
    id: 'pe_x',
    from: 0,
    to: 5,
    newText: 'new',
    reason: 'test',
    relation: 'cascade',
    status: 'pending',
    targetText: 'old',
    severity: 'probably',
    evidence: null,
    ...overrides,
  }
}

const primary = edit({ id: 'pe_primary', relation: 'primary', from: 10, to: 20, severity: 'must' })
const cascadeAbove = edit({ id: 'pe_above', from: 30, to: 40 })
const cascadeBelow = edit({ id: 'pe_below', from: 200, to: 210 })
const all = [primary, cascadeAbove, cascadeBelow]

describe('partitionCascadeReveal', () => {
  it('highWaterMark 0 (no reading tracked yet) reveals everything immediately', () => {
    // Deliberate: fresh sessions and headless flows have no reading signal —
    // holding cascades behind a mark that may never move would hide review UI.
    const { reveal, held } = partitionCascadeReveal(all, 0, 25)
    expect(reveal).toEqual(all)
    expect(held).toEqual([])
  })

  it('high-water mark past the breakpoint reveals everything', () => {
    const { reveal, held } = partitionCascadeReveal(all, 25, 25)
    expect(reveal).toEqual(all)
    expect(held).toEqual([])
  })

  it('holds below-read-line cascades, reveals primary + already-read cascades', () => {
    // Reader is at 100: primary (always) and the cascade at 30 (already read —
    // must flag) reveal; the cascade at 200 is held for the breakpoint.
    const { reveal, held } = partitionCascadeReveal(all, 100, 300)
    expect(reveal.map((e) => e.id)).toEqual(['pe_primary', 'pe_above'])
    expect(held.map((e) => e.id)).toEqual(['pe_below'])
  })

  it('primary is always revealed even when below the read line', () => {
    const farPrimary = edit({ id: 'pe_p2', relation: 'primary', from: 500, to: 510 })
    const { reveal, held } = partitionCascadeReveal([farPrimary, cascadeBelow], 100, 600)
    expect(reveal.map((e) => e.id)).toEqual(['pe_p2'])
    expect(held.map((e) => e.id)).toEqual(['pe_below'])
  })

  it('cascade exactly at the high-water mark counts as unread (held)', () => {
    const at = edit({ id: 'pe_at', from: 100, to: 110 })
    const { held } = partitionCascadeReveal([primary, at], 100, 300)
    expect(held.map((e) => e.id)).toEqual(['pe_at'])
  })
})

describe('cascadeBreakpointPos', () => {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', { blockId: 'b1' }, [schema.text('first paragraph')]),
    schema.node('paragraph', { blockId: 'b2' }, [schema.text('second paragraph')]),
  ])
  // b1: pos 0, nodeSize 17 → content end 16. b2 starts at 17.

  it('uses the primary blockId to find the block content end', () => {
    const pos = cascadeBreakpointPos(doc, { to: 3, blockId: 'b1' })
    expect(pos).toBe(16)
  })

  it('falls back to resolving the edit position when blockId is missing', () => {
    const pos = cascadeBreakpointPos(doc, { to: 3 })
    expect(pos).toBe(16)
  })

  it('falls back to resolving when the blockId no longer exists', () => {
    const pos = cascadeBreakpointPos(doc, { to: 20, blockId: 'gone' })
    // Position 20 is inside b2 (content 18..34).
    expect(pos).toBe(34)
  })

  it('returns 0 (reveal immediately) when there is no primary', () => {
    expect(cascadeBreakpointPos(doc, undefined)).toBe(0)
  })

  it('clamps out-of-range positions instead of throwing', () => {
    const pos = cascadeBreakpointPos(doc, { to: 9999 })
    expect(typeof pos).toBe('number')
  })
})
