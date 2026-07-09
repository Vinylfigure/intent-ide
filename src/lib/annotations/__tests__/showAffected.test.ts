import { describe, it, expect } from 'vitest'
import { showAffectedMode } from '../showAffected'
import type {
  Annotation,
  AnnotationStatus,
  ProposedEdit,
  ProposedEditRelation,
} from '../types'

function edit(relation: ProposedEditRelation): ProposedEdit {
  return {
    id: `pe_${relation}_${Math.random().toString(36).slice(2)}`,
    from: 1,
    to: 5,
    newText: 'new',
    reason: 'r',
    relation,
    status: 'pending',
    targetText: 'old',
    severity: relation === 'primary' ? 'must' : 'probably',
    evidence: null,
  }
}

function ann(status: AnnotationStatus, edits?: ProposedEdit[]): Annotation {
  return {
    id: 'a1',
    documentId: 'd1',
    locationGroupKey: 'k',
    type: 'edit',
    status,
    transcript: 't',
    anchor: { from: 1, to: 5, scope: 'phrase', text: 'old' },
    resolution:
      edits === undefined
        ? null
        : {
            type: 'edit',
            content: 'c',
            suggestedEdit: null,
            edits,
            actions: [],
          },
    conversation: [],
    parentId: null,
    childIds: [],
    createdAt: 0,
    resolvedAt: null,
    verbosity: 'normal',
  }
}

describe('showAffectedMode', () => {
  it('scroll: resolved annotation with cascade edits (CascadeList is mounted)', () => {
    expect(showAffectedMode(ann('resolved', [edit('primary'), edit('cascade')]))).toBe('scroll')
  })

  it('followup: APPLIED annotation with cascade edits — the list is unmounted, scrolling would be a dead button', () => {
    expect(showAffectedMode(ann('applied', [edit('primary'), edit('cascade')]))).toBe('followup')
  })

  it('followup: dismissed annotation with cascade edits', () => {
    expect(showAffectedMode(ann('dismissed', [edit('primary'), edit('cascade')]))).toBe('followup')
  })

  it('followup: resolved but only a primary edit (no cascades to show)', () => {
    expect(showAffectedMode(ann('resolved', [edit('primary')]))).toBe('followup')
  })

  it('followup: resolved with empty edits or no resolution at all', () => {
    expect(showAffectedMode(ann('resolved', []))).toBe('followup')
    expect(showAffectedMode(ann('resolved'))).toBe('followup')
  })
})
