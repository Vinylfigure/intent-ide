import { describe, it, expect } from 'vitest'
import { schema } from '@/lib/prosemirror/schema'
import { answerBreakpointPos, answerDwellMs, shouldRevealAnswer } from '../answerReveal'

// ---------------------------------------------------------------------------
// shouldRevealAnswer matrix
// ---------------------------------------------------------------------------

describe('shouldRevealAnswer', () => {
  it('reveals when the high-water mark has crossed the breakpoint', () => {
    expect(
      shouldRevealAnswer({ highWaterMark: 120, breakpointPos: 100, msSinceHeld: 0, dwellMs: 5000 }),
    ).toBe(true)
  })

  it('reveals when the high-water mark sits exactly at the breakpoint', () => {
    expect(
      shouldRevealAnswer({ highWaterMark: 100, breakpointPos: 100, msSinceHeld: 0, dwellMs: 5000 }),
    ).toBe(true)
  })

  it('holds while the high-water mark is before the breakpoint', () => {
    expect(
      shouldRevealAnswer({
        highWaterMark: 50,
        breakpointPos: 100,
        msSinceHeld: 999999,
        dwellMs: 5000,
      }),
    ).toBe(false)
  })

  it('with no reading signal (hwm 0), holds before the dwell elapses', () => {
    expect(
      shouldRevealAnswer({ highWaterMark: 0, breakpointPos: 100, msSinceHeld: 4999, dwellMs: 5000 }),
    ).toBe(false)
  })

  it('with no reading signal (hwm 0), reveals once the dwell elapses', () => {
    expect(
      shouldRevealAnswer({ highWaterMark: 0, breakpointPos: 100, msSinceHeld: 5000, dwellMs: 5000 }),
    ).toBe(true)
  })

  it('breakpoint 0 (unresolvable) fails open and reveals immediately', () => {
    expect(
      shouldRevealAnswer({ highWaterMark: 0, breakpointPos: 0, msSinceHeld: 0, dwellMs: 5000 }),
    ).toBe(true)
    expect(
      shouldRevealAnswer({ highWaterMark: 50, breakpointPos: 0, msSinceHeld: 0, dwellMs: 5000 }),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// answerDwellMs
// ---------------------------------------------------------------------------

describe('answerDwellMs', () => {
  it('applies the 2000ms floor for tiny blocks', () => {
    expect(answerDwellMs('one two three')).toBe(2000)
    expect(answerDwellMs('')).toBe(2000)
    expect(answerDwellMs('   ')).toBe(2000)
  })

  it('caps at 15000ms for very long blocks', () => {
    const long = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ')
    expect(answerDwellMs(long)).toBe(15000)
  })

  it('scales linearly at 250 wpm between floor and cap', () => {
    // 25 words at 250 wpm = 0.1 min = 6000ms
    const words25 = Array.from({ length: 25 }, (_, i) => `w${i}`).join(' ')
    expect(answerDwellMs(words25)).toBe(6000)
  })
})

// ---------------------------------------------------------------------------
// answerBreakpointPos on a real schema doc
// ---------------------------------------------------------------------------

describe('answerBreakpointPos', () => {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text('first paragraph')]),
    schema.node('paragraph', null, [schema.text('second paragraph')]),
  ])
  // Paragraph 1: pos 0, nodeSize 17 → content end 16. Paragraph 2: 17..34.

  it('returns the content end of the block containing the anchor end', () => {
    expect(answerBreakpointPos(doc, { to: 3 })).toBe(16)
  })

  it('resolves anchors inside the second block to its content end', () => {
    expect(answerBreakpointPos(doc, { to: 20 })).toBe(34)
  })

  it('clamps out-of-range anchors instead of throwing', () => {
    const pos = answerBreakpointPos(doc, { to: 9999 })
    expect(typeof pos).toBe('number')
    expect(pos).toBeGreaterThanOrEqual(0)
  })

  it('returns 0 (fail-open) when the position resolves to the doc top level', () => {
    // doc.content.size resolves at depth 0 → no block to end at.
    expect(answerBreakpointPos(doc, { to: doc.content.size })).toBe(0)
  })
})
