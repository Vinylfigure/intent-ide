import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useChangesStore } from '@/stores/changesStore'
import { useDocumentStore } from '@/stores/documentStore'
import { useToastStore } from '@/stores/toastStore'
import type { Invariant } from '../captureInvariant'
import { runAndSurfaceInvariantChecks } from '../invariantCascade'

function p(blockId: string, text: string): PMNode {
  return schema.node('paragraph', { blockId }, [schema.text(text)])
}

const DECLARE_TEXT = 'Terminations are now 30 days per the updated policy.'
const CONFLICT_TEXT = 'Under the new policy, terminations occur within 45 days of notice.'

const DOC = schema.node('doc', null, [p('b-declare', DECLARE_TEXT), p('b-conflict', CONFLICT_TEXT)])

function invariantRecord(overrides: Partial<Invariant> = {}): Invariant {
  return {
    id: 'inv-1',
    documentId: 'doc-A',
    statement: 'terminations are now 30 days',
    blockIds: JSON.stringify(['b-declare']),
    checkKind: 'deterministic',
    status: 'active',
    provenanceCommitHash: 'hash-1',
    createdAt: '2026-08-18T00:00:00.000Z',
    ...overrides,
  }
}

function stubListInvariants(invariants: Invariant[], onFetch?: () => void) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      onFetch?.()
      return {
        ok: true,
        status: 200,
        json: async () => ({ invariants }),
      } as Response
    }),
  )
}

beforeEach(() => {
  useAnnotationStore.getState().clear()
  useChangesStore.getState().clear()
  useToastStore.setState({ toasts: [] })
  useDocumentStore.setState({ activeDocumentId: 'doc-A' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runAndSurfaceInvariantChecks', () => {
  it('surfaces a violation as a resolved flag annotation with a rejected no-op primary + no-op cascade', async () => {
    stubListInvariants([invariantRecord()])
    const state = EditorState.create({ schema, doc: DOC })

    await runAndSurfaceInvariantChecks('doc-A', state)

    const annotations = useAnnotationStore.getState().annotations
    expect(annotations).toHaveLength(1)
    const a = annotations[0]
    expect(a.type).toBe('flag')
    expect(a.status).toBe('resolved')
    expect(a.documentId).toBe('doc-A')

    const edits = a.resolution!.edits!
    expect(edits).toHaveLength(2)
    const [primary, cascade] = edits
    expect(primary.relation).toBe('primary')
    expect(primary.status).toBe('rejected')
    expect(primary.newText).toBe(primary.targetText) // no-op
    expect(primary.blockId).toBe('b-declare')

    expect(cascade.relation).toBe('cascade')
    expect(cascade.status).toBe('pending')
    expect(cascade.newText).toBe(cascade.targetText) // no-op — a flag never auto-edits
    expect(cascade.blockId).toBe('b-conflict')
    // Statement text verifies verbatim against the declaring block, so this
    // is a verified citation, not a fabricated one.
    expect(cascade.evidence).toEqual({
      sourceBlockId: 'b-declare',
      quotedText: '30',
      edgeType: 'contradicts',
    })
    expect(cascade.severity).toBe('must')

    expect(useChangesStore.getState().getChangeSetByAnnotationId(a.id)).toBeTruthy()
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })

  it('does not re-surface the same (invariant, conflicting block) pair on a later apply', async () => {
    stubListInvariants([invariantRecord()])
    const state = EditorState.create({ schema, doc: DOC })

    await runAndSurfaceInvariantChecks('doc-A', state)
    await runAndSurfaceInvariantChecks('doc-A', state)

    expect(useAnnotationStore.getState().annotations).toHaveLength(1)
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })

  it('produces no flag and makes no network call when the active document already changed', async () => {
    useDocumentStore.setState({ activeDocumentId: 'doc-B' })
    const fetchSpy = vi.fn()
    stubListInvariants([invariantRecord()], fetchSpy)
    const state = EditorState.create({ schema, doc: DOC })

    await runAndSurfaceInvariantChecks('doc-A', state)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(useAnnotationStore.getState().annotations).toHaveLength(0)
  })

  it('aborts when the active document changes DURING the listInvariants round-trip', async () => {
    stubListInvariants([invariantRecord()], () => {
      useDocumentStore.setState({ activeDocumentId: 'doc-B' })
    })
    const state = EditorState.create({ schema, doc: DOC })

    await runAndSurfaceInvariantChecks('doc-A', state)

    expect(useAnnotationStore.getState().annotations).toHaveLength(0)
  })

  it('produces nothing when no invariant is violated', async () => {
    stubListInvariants([])
    const state = EditorState.create({ schema, doc: DOC })

    await runAndSurfaceInvariantChecks('doc-A', state)

    expect(useAnnotationStore.getState().annotations).toHaveLength(0)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('degrades to unverified (probably, no evidence) when the declared figure is not a literal substring of the declaring block', async () => {
    // The declaring block spells the figure as "30 dollars"; the captured
    // statement uses "$30" — a different formatting of the same value, which
    // the CHECK correctly treats as equal (normalized numeric comparison),
    // but `blockTextRange`'s citation check is deliberately literal, so it
    // must fail here rather than fabricate a verbatim quote that isn't one.
    const declareText = 'The cancellation fee is now 30 dollars under the updated policy.'
    const conflictText = 'Note: the cancellation fee is 50 dollars as of last quarter.'
    const doc = schema.node('doc', null, [p('b-declare', declareText), p('b-conflict', conflictText)])
    stubListInvariants([
      invariantRecord({ statement: 'the cancellation fee is now $30', blockIds: JSON.stringify(['b-declare']) }),
    ])
    const state = EditorState.create({ schema, doc })

    await runAndSurfaceInvariantChecks('doc-A', state)

    const annotations = useAnnotationStore.getState().annotations
    expect(annotations).toHaveLength(1)
    const cascade = annotations[0].resolution!.edits![1]
    expect(cascade.evidence).toBeNull()
    expect(cascade.severity).toBe('probably')
  })

  it('never mutates the document even if the caller applies the cascade edit as-is (no-op by construction)', async () => {
    stubListInvariants([invariantRecord()])
    const state = EditorState.create({ schema, doc: DOC })

    await runAndSurfaceInvariantChecks('doc-A', state)

    const cascade = useAnnotationStore.getState().annotations[0].resolution!.edits![1]
    const tr = state.tr.replaceWith(cascade.from, cascade.to, schema.text(cascade.newText))
    const next = state.apply(tr)
    expect(next.doc.textBetween(cascade.from, cascade.to)).toBe(cascade.targetText)
  })
})
