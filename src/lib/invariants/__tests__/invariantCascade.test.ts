import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useChangesStore } from '@/stores/changesStore'
import { useDocumentStore } from '@/stores/documentStore'
import { useToastStore } from '@/stores/toastStore'
import { useInvariantFlagStore } from '@/stores/invariantFlagStore'
import type { Invariant } from '../captureInvariant'
import {
  invariantIdFromFlagKey,
  resolveInvariantFlagOnDismiss,
  runAndSurfaceInvariantChecks,
} from '../invariantCascade'

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
    supersedesId: null,
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
  useInvariantFlagStore.getState().clear()
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

  it('degrades to unverified (optional, no evidence) when the declared figure is not a literal substring of the declaring block', async () => {
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
    expect(cascade.severity).toBe('optional')
  })

  it('rejects a coincidental substring match ("30" inside "2030") as a verified citation', async () => {
    const declareText = 'The renewal year is now set to 2030 under the updated policy.'
    const conflictText = 'Under the new policy, terminations occur within 45 days of notice.'
    const doc = schema.node('doc', null, [p('b-declare', declareText), p('b-conflict', conflictText)])
    // "terminations ... 30 days" would word-boundary-verify against neither
    // block's "2030" — this pins that a bare contiguity match is rejected.
    stubListInvariants([invariantRecord({ statement: 'terminations are now 30 days' })])
    const state = EditorState.create({ schema, doc })

    await runAndSurfaceInvariantChecks('doc-A', state)

    const annotations = useAnnotationStore.getState().annotations
    expect(annotations).toHaveLength(1)
    const cascade = annotations[0].resolution!.edits![1]
    expect(cascade.evidence).toBeNull()
    expect(cascade.severity).toBe('optional')
  })

  it('dedup survives an unrelated annotationStore.clear() (e.g. starting a new document elsewhere)', async () => {
    stubListInvariants([invariantRecord()])
    const state = EditorState.create({ schema, doc: DOC })

    await runAndSurfaceInvariantChecks('doc-A', state)
    expect(useAnnotationStore.getState().annotations).toHaveLength(1)

    // Simulates DocInputModal.loadDoc()'s unscoped clear when the user
    // starts an unrelated new document while doc-A stays open elsewhere.
    useAnnotationStore.getState().clear()
    expect(useAnnotationStore.getState().annotations).toHaveLength(0)

    await runAndSurfaceInvariantChecks('doc-A', state)

    // Dedup memory lives in invariantFlagStore, not annotationStore, so the
    // still-unresolved conflict does NOT get re-injected as a duplicate.
    expect(useAnnotationStore.getState().annotations).toHaveLength(0)
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

  it('produces no flag for an invariant already resolved (#35: dismissing a flag stops it being checked)', async () => {
    // Simulates what GET /api/invariants returns once a "Nevermind" resolve
    // has landed: the live row for this fact now has status 'resolved', not
    // 'active' — checkInvariants (and therefore this runner) must skip it,
    // exactly as it already does for entailment-kind and superseded rows.
    stubListInvariants([invariantRecord({ status: 'resolved', supersedesId: null })])
    const state = EditorState.create({ schema, doc: DOC })

    await runAndSurfaceInvariantChecks('doc-A', state)

    expect(useAnnotationStore.getState().annotations).toHaveLength(0)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})

describe('invariantIdFromFlagKey', () => {
  it('recovers the invariantId from a locationGroupKey produced for an invariant-check flag', () => {
    expect(invariantIdFromFlagKey('doc-A:invariant:inv-1:b-conflict')).toBe('inv-1')
  })

  it('returns null for a locationGroupKey that is not an invariant-flag key', () => {
    expect(invariantIdFromFlagKey('some-other-annotation-key')).toBeNull()
  })

  it('is unfooled by a documentId that itself contains a colon', () => {
    expect(invariantIdFromFlagKey('doc:with:colons:invariant:inv-9:b-1')).toBe('inv-9')
  })

  it('is unfooled by a documentId that itself contains the literal ":invariant:" marker', () => {
    // A front-anchored (indexOf-from-the-start) parse would find the FIRST
    // ":invariant:" occurrence and misparse this as invariantId="evil" — the
    // real invariantId is only recoverable by anchoring from the END.
    expect(invariantIdFromFlagKey('doc:invariant:evil:invariant:inv-9:b-1')).toBe('inv-9')
  })

  it('returns null for a key one segment short of the minimum shape', () => {
    expect(invariantIdFromFlagKey('doc-A:invariant:inv-1')).toBeNull()
  })
})

describe('resolveInvariantFlagOnDismiss', () => {
  const FLAG_KEY = 'doc-A:invariant:inv-1:b-conflict'

  it('no-ops (and makes no network call) for a non-invariant annotation', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await resolveInvariantFlagOnDismiss({ documentId: 'doc-A', locationGroupKey: 'some-other-key' })

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('resolves the ledger row and prunes the dedup entry on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ invariant: { id: 'inv-2', supersedesId: 'inv-1', status: 'resolved' } }),
      })),
    )
    useInvariantFlagStore.getState().markSurfaced(FLAG_KEY)

    await resolveInvariantFlagOnDismiss({ documentId: 'doc-A', locationGroupKey: FLAG_KEY })

    expect(fetch).toHaveBeenCalledWith(
      '/api/invariants/resolve',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(useInvariantFlagStore.getState().hasSurfaced(FLAG_KEY)).toBe(false)
  })

  it('leaves the dedup entry intact (and warns) when the resolve call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })),
    )
    useInvariantFlagStore.getState().markSurfaced(FLAG_KEY)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await resolveInvariantFlagOnDismiss({ documentId: 'doc-A', locationGroupKey: FLAG_KEY })

    // Still surfaced — a network failure must not silently drop dedup memory
    // and let the doc-CI lane re-flag this as a brand-new annotation later.
    expect(useInvariantFlagStore.getState().hasSurfaced(FLAG_KEY)).toBe(true)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('entailment lane surfacing (#51)', () => {
  const ENTAILMENT_DOC = schema.node('doc', null, [
    p('b-declare', 'Terminations are now thirty days per the updated policy.'),
    p('b-conflict', 'Under the new policy, terminations occur within one and a half months.'),
  ])

  const entailmentRecord = () =>
    invariantRecord({
      id: 'inv-e',
      statement: 'terminations are now thirty days',
      checkKind: 'entailment',
    })

  const confirmingJudge = async (pairs: { blockId: string }[]) =>
    new Map(pairs.map((_, i) => [i, { contradicts: true, reason: 'Not thirty days.' }]))

  it('makes no entailment call at all while the setting is off', async () => {
    stubListInvariants([entailmentRecord()])
    const judge = vi.fn(confirmingJudge)
    const state = EditorState.create({ schema, doc: ENTAILMENT_DOC })

    await runAndSurfaceInvariantChecks('doc-A', state, {
      entailmentEnabled: false,
      entailmentDeps: { judge, graph: null },
    })

    expect(judge).not.toHaveBeenCalled()
    expect(useAnnotationStore.getState().annotations).toEqual([])
  })

  it('surfaces a confirmed entailment conflict through the same CascadeList flag', async () => {
    stubListInvariants([entailmentRecord()])
    const state = EditorState.create({ schema, doc: ENTAILMENT_DOC })

    await runAndSurfaceInvariantChecks('doc-A', state, {
      entailmentEnabled: true,
      entailmentDeps: { judge: vi.fn(confirmingJudge), graph: null },
    })

    const annotations = useAnnotationStore.getState().annotations
    expect(annotations).toHaveLength(1)
    const [primary, cascade] = annotations[0].resolution!.edits!
    expect(primary.status).toBe('rejected')
    expect(cascade.newText).toBe(cascade.targetText) // still a no-op — flags never edit
    expect(cascade.blockId).toBe('b-conflict')
    expect(cascade.reason).toContain('Not thirty days.')
    // No verbatim figure to cite, so it degrades to a lead — an uncited
    // proposal can never be 'must'.
    expect(cascade.evidence).toBeNull()
    expect(cascade.severity).toBe('optional')
  })

  it('surfaces nothing when the entailment judge fails', async () => {
    stubListInvariants([entailmentRecord()])
    const state = EditorState.create({ schema, doc: ENTAILMENT_DOC })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await runAndSurfaceInvariantChecks('doc-A', state, {
      entailmentEnabled: true,
      entailmentDeps: {
        judge: vi.fn(async () => {
          throw new Error('provider down')
        }),
        graph: null,
      },
    })

    expect(useAnnotationStore.getState().annotations).toEqual([])
    warn.mockRestore()
  })

  it('aborts without flagging when the active document changed during the judge call', async () => {
    stubListInvariants([entailmentRecord()])
    const state = EditorState.create({ schema, doc: ENTAILMENT_DOC })

    await runAndSurfaceInvariantChecks('doc-A', state, {
      entailmentEnabled: true,
      entailmentDeps: {
        judge: async (pairs) => {
          useDocumentStore.setState({ activeDocumentId: 'doc-B' })
          return new Map(pairs.map((_, i) => [i, { contradicts: true, reason: 'r' }]))
        },
        graph: null,
      },
    })

    expect(useAnnotationStore.getState().annotations).toEqual([])
  })
})
