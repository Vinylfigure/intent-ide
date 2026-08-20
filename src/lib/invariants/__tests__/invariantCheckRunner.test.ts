import { describe, it, expect } from 'vitest'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'
import { checkInvariants } from '../invariantCheckRunner'
import type { Invariant } from '../captureInvariant'

function p(blockId: string, text: string): PMNode {
  return schema.node('paragraph', { blockId }, text ? [schema.text(text)] : [])
}

function docOf(...blocks: PMNode[]): PMNode {
  return schema.node('doc', null, blocks)
}

function invariant(overrides: Partial<Invariant> = {}): Invariant {
  return {
    id: 'inv-1',
    documentId: 'doc-1',
    statement: 'terminations are now 30 days',
    blockIds: JSON.stringify(['b-declare']),
    checkKind: 'deterministic',
    status: 'active',
    provenanceCommitHash: 'hash-1',
    supersedesId: null,
    createdAt: '2026-08-18T00:00:00.000Z',
    ...overrides,
  }
}

describe('checkInvariants', () => {
  it('produces no flag when nothing conflicts with the declared fact', () => {
    const doc = docOf(
      p('b-declare', 'Terminations are now 30 days per the updated policy.'),
      p('b-other', 'Employees may appeal any decision within 10 business days.'),
    )
    const violations = checkInvariants(doc, [invariant()])
    expect(violations).toEqual([])
  })

  it('does not flag a block that merely corroborates the same figure', () => {
    const doc = docOf(
      p('b-declare', 'Terminations are now 30 days per the updated policy.'),
      p('b-other', 'As noted above, terminations require 30 days notice.'),
    )
    const violations = checkInvariants(doc, [invariant()])
    expect(violations).toEqual([])
  })

  it('flags the founder fixture: a later conflicting figure for the same subject', () => {
    const doc = docOf(
      p('b-declare', 'Terminations are now 30 days per the updated policy.'),
      p('b-conflict', 'Under the new policy, terminations occur within 45 days of notice.'),
    )
    const violations = checkInvariants(doc, [invariant()])
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      invariantId: 'inv-1',
      statement: 'terminations are now 30 days',
      evidenceBlockIds: ['b-declare'],
      conflictBlockId: 'b-conflict',
      statementNumber: '30',
      conflictNumber: '45',
    })
    expect(violations[0].conflictText).toContain('45 days')
  })

  it("never flags the invariant's own evidence block", () => {
    const doc = docOf(p('b-declare', 'Terminations are now 30 days, not 45 days, per legal review.'))
    const violations = checkInvariants(doc, [invariant()])
    expect(violations).toEqual([])
  })

  it('skips entailment-kind invariants without erroring', () => {
    const doc = docOf(
      p('b-declare', 'Terminations are now 30 days per the updated policy.'),
      p('b-conflict', 'Under the new policy, terminations occur within 45 days of notice.'),
    )
    const violations = checkInvariants(doc, [invariant({ checkKind: 'entailment' })])
    expect(violations).toEqual([])
  })

  it('skips inactive (superseded) invariants', () => {
    const doc = docOf(
      p('b-declare', 'Terminations are now 30 days per the updated policy.'),
      p('b-conflict', 'Under the new policy, terminations occur within 45 days of notice.'),
    )
    const violations = checkInvariants(doc, [invariant({ status: 'superseded' })])
    expect(violations).toEqual([])
  })

  it('skips inactive (resolved via the #35 "Nevermind" flow) invariants', () => {
    const doc = docOf(
      p('b-declare', 'Terminations are now 30 days per the updated policy.'),
      p('b-conflict', 'Under the new policy, terminations occur within 45 days of notice.'),
    )
    const violations = checkInvariants(doc, [invariant({ status: 'resolved' })])
    expect(violations).toEqual([])
  })

  it('does not flag an unrelated block that merely shares a number', () => {
    const doc = docOf(
      p('b-declare', 'Terminations are now 30 days per the updated policy.'),
      p('b-other', 'The office holds 45 chairs in the main conference room.'),
    )
    const violations = checkInvariants(doc, [invariant()])
    expect(violations).toEqual([])
  })

  it('checks multiple invariants independently, one flag per violated invariant', () => {
    const doc = docOf(
      p('b-declare-1', 'Terminations are now 30 days per the updated policy.'),
      p('b-conflict-1', 'Under the new policy, terminations occur within 45 days of notice.'),
      p('b-declare-2', 'Refunds are processed within 14 business days.'),
      p('b-other-2', 'Support tickets are answered within 14 business days.'),
    )
    const violations = checkInvariants(doc, [
      invariant({ id: 'inv-1', statement: 'terminations are now 30 days', blockIds: JSON.stringify(['b-declare-1']) }),
      invariant({ id: 'inv-2', statement: 'refunds are processed within 14 business days', blockIds: JSON.stringify(['b-declare-2']) }),
    ])
    expect(violations).toHaveLength(1)
    expect(violations[0].invariantId).toBe('inv-1')
  })

  it('does not false-positive on a two-term statement matching only its shorter, generic term', () => {
    // "days" alone is not enough evidence of relatedness — requires BOTH
    // "terminations" and "days" (all terms, since the statement has only 2).
    const doc = docOf(
      p('b-declare', 'Terminations are now 30 days per the updated policy.'),
      p('b-unrelated', 'For terminations effective under state law, see form 12 for filing requirements.'),
    )
    const violations = checkInvariants(doc, [invariant()])
    expect(violations).toEqual([])
  })

  it('treats "$30" and "30" as the same figure (currency-symbol normalization)', () => {
    const doc = docOf(
      p('b-declare', 'The cancellation fee is now $30 per the updated policy.'),
      p('b-other', 'As noted above, the cancellation fee is 30 dollars, unchanged.'),
    )
    const violations = checkInvariants(doc, [
      invariant({ statement: 'the cancellation fee is now $30', blockIds: JSON.stringify(['b-declare']) }),
    ])
    expect(violations).toEqual([])
  })

  it('treats "$30" and "$30.00" as the same figure (decimal-format normalization)', () => {
    const doc = docOf(
      p('b-declare', 'The cancellation fee is now $30 per the updated policy.'),
      p('b-other', 'As noted above, the cancellation fee is $30.00, unchanged.'),
    )
    const violations = checkInvariants(doc, [
      invariant({ statement: 'the cancellation fee is now $30', blockIds: JSON.stringify(['b-declare']) }),
    ])
    expect(violations).toEqual([])
  })

  it('prefers the LAST numeric token as the declared figure for a "from X to Y" statement', () => {
    const doc = docOf(
      p('b-declare', 'The subscription fee increased from $20 to $30 per the updated policy.'),
      p('b-conflict', 'Note: the subscription fee increased again to $50 last quarter.'),
    )
    const violations = checkInvariants(doc, [
      invariant({
        statement: 'the subscription fee increased from $20 to $30',
        blockIds: JSON.stringify(['b-declare']),
      }),
    ])
    expect(violations).toHaveLength(1)
    // "$30" (the current value), not "$20" (the superseded value).
    expect(violations[0].statementNumber).toBe('$30')
  })

  it('flags a genuinely different figure even with currency-symbol formatting differences', () => {
    const doc = docOf(
      p('b-declare', 'The cancellation fee is now $30 per the updated policy.'),
      p('b-conflict', 'Note: the cancellation fee is $50 as of last quarter.'),
    )
    const violations = checkInvariants(doc, [
      invariant({ statement: 'the cancellation fee is now $30', blockIds: JSON.stringify(['b-declare']) }),
    ])
    expect(violations).toHaveLength(1)
    expect(violations[0].conflictBlockId).toBe('b-conflict')
  })
})
