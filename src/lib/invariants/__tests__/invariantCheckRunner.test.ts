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
    })
    expect(violations[0].conflictText).toContain('45 days')
  })

  it('never flags the invariant\'s own evidence block', () => {
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

  it('skips inactive (already-resolved) invariants', () => {
    const doc = docOf(
      p('b-declare', 'Terminations are now 30 days per the updated policy.'),
      p('b-conflict', 'Under the new policy, terminations occur within 45 days of notice.'),
    )
    const violations = checkInvariants(doc, [invariant({ status: 'superseded' })])
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
})
