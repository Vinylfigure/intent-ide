import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'
import { blockTextRange } from '@/lib/prosemirror/blockIds'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useChangesStore } from '@/stores/changesStore'
import { useToastStore } from '@/stores/toastStore'
import { useDocumentStore } from '@/stores/documentStore'
import { useDirectEditOfferStore } from '@/stores/directEditOfferStore'
import type { ProposedEdit } from '../types'
import type { DirectEditOffer } from '../directEditTrigger'
import { runDirectEditCascade, type ProposeCascadesFn } from '../directEditCascade'

function p(blockId: string, text: string): PMNode {
  return schema.node('paragraph', { blockId }, [schema.text(text)])
}

const BEFORE_TEXT = '"Total Budget" means $50,000 allocated for the 2026 pilot program.'
const AFTER_TEXT = '"Total Budget" means $75,000 allocated for the 2026 pilot program.'

const DOC = schema.node('doc', null, [
  p('b1', AFTER_TEXT), // the human edit is ALREADY applied
  p('b2', 'Marketing may spend at most ten percent of the Total Budget in any quarter.'),
])

function offerFor(doc: PMNode): DirectEditOffer {
  const range = blockTextRange(doc, 'b1', AFTER_TEXT)!
  return {
    documentId: 'doc-A',
    blockId: 'b1',
    blockText: AFTER_TEXT,
    beforeText: BEFORE_TEXT,
    from: range.from,
    to: range.to,
    dependentCount: 1,
  }
}

function fakeCascade(doc: PMNode): ProposedEdit {
  const range = blockTextRange(doc, 'b2', '$50,000')
  // b2 has no $50,000 in this fixture — anchor the cascade on the term instead.
  const target = range ?? blockTextRange(doc, 'b2', 'ten percent')!
  return {
    id: 'pe_test_cascade',
    from: target.from,
    to: target.to,
    newText: 'twenty percent',
    reason: 'stale share of the raised budget',
    relation: 'cascade',
    status: 'pending',
    targetText: doc.textBetween(target.from, target.to),
    blockId: 'b2',
    severity: 'must',
    evidence: { sourceBlockId: 'b1', quotedText: '$75,000', edgeType: 'references' },
  }
}

const fetchSpy = vi.fn(() => {
  throw new Error('unexpected network call')
})

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy)
  fetchSpy.mockClear()
  useAnnotationStore.getState().clear()
  useChangesStore.getState().clear()
  useToastStore.setState({ toasts: [] })
  useDocumentStore.setState({ activeDocumentId: 'doc-A' })
  useDirectEditOfferStore.getState().clearOffer()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runDirectEditCascade', () => {
  it('makes no network call until invoked, then calls propose ONCE with primaryBefore (the consent boundary)', async () => {
    const state = EditorState.create({ schema, doc: DOC })
    const offer = offerFor(state.doc)

    // Nothing so far (module import, offer construction) touched the network.
    expect(fetchSpy).not.toHaveBeenCalled()

    const propose = vi.fn(async (...args: Parameters<ProposeCascadesFn>) => {
      void args
      return [fakeCascade(state.doc)]
    })
    await runDirectEditCascade({ state }, offer, propose as ProposeCascadesFn)

    expect(propose).toHaveBeenCalledTimes(1)
    const [calledState, primary, , opts] = propose.mock.calls[0]
    expect(calledState).toBe(state)
    // Primary replays the user's own applied edit over the block's range…
    expect(primary.from).toBe(offer.from)
    expect(primary.to).toBe(offer.to)
    expect(primary.newText).toBe(AFTER_TEXT)
    // …and the inversion guard carries the pre-edit text explicitly.
    expect(opts?.primaryBefore).toBe(BEFORE_TEXT)
    // The scripted propose fn is the only "network"; fetch itself stayed cold.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('creates a resolved edit annotation: rejected no-op primary + appended cascades', async () => {
    const state = EditorState.create({ schema, doc: DOC })
    const offer = offerFor(state.doc)
    const cascade = fakeCascade(state.doc)

    await runDirectEditCascade({ state }, offer, (async () => [cascade]) as ProposeCascadesFn)

    const annotations = useAnnotationStore.getState().annotations
    expect(annotations).toHaveLength(1)
    const a = annotations[0]

    expect(a.type).toBe('edit')
    expect(a.status).toBe('resolved')
    expect(a.transcript).toContain('Direct edit:')
    expect(a.transcript).toContain('$50,000') // before…
    expect(a.transcript).toContain('$75,000') // …and after both survive truncation
    expect(a.anchor).toMatchObject({ from: offer.from, to: offer.to, scope: 'paragraph', text: AFTER_TEXT })

    const res = a.resolution!
    expect(res.suggestedEdit).not.toBeNull()
    expect(res.edits).toHaveLength(2)
    const [primary, appended] = res.edits!
    // The primary is a harmless no-op: same text in and out, pre-rejected so
    // the commit modal starts it toggled OFF and it can never re-apply.
    expect(primary.relation).toBe('primary')
    expect(primary.status).toBe('rejected')
    expect(primary.targetText).toBe(AFTER_TEXT)
    expect(primary.newText).toBe(AFTER_TEXT)
    expect(primary.blockId).toBe('b1')
    expect(appended).toEqual(cascade)
    // Edit-type action set (copied from the resolver's private table).
    expect(res.actions.map((x) => x.handler)).toContain('apply-edit')

    // Review-flow plumbing: change set exists, annotation is active.
    expect(useChangesStore.getState().getChangeSetByAnnotationId(a.id)).toBeTruthy()
    expect(useAnnotationStore.getState().activeAnnotationId).toBe(a.id)
    // No toast on the annotation path.
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('zero cascades → quiet toast, no annotation, no change set', async () => {
    const state = EditorState.create({ schema, doc: DOC })
    const offer = offerFor(state.doc)

    await runDirectEditCascade({ state }, offer, (async () => []) as ProposeCascadesFn)

    expect(useAnnotationStore.getState().annotations).toHaveLength(0)
    expect(useChangesStore.getState().changeSets).toHaveLength(0)
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe('No dependent changes needed')
  })

  it('propose resolving AFTER a doc switch creates no annotation (aborts + clears the offer)', async () => {
    const state = EditorState.create({ schema, doc: DOC })
    const offer = offerFor(state.doc)
    useDirectEditOfferStore.getState().setOffer(offer)

    // The doc switch happens while the (long) propose round-trip is in flight.
    const propose = vi.fn(async () => {
      useDocumentStore.setState({ activeDocumentId: 'doc-B' })
      return [fakeCascade(state.doc)]
    })
    await runDirectEditCascade({ state }, offer, propose as unknown as ProposeCascadesFn)

    expect(propose).toHaveBeenCalledTimes(1)
    expect(useAnnotationStore.getState().annotations).toHaveLength(0)
    expect(useChangesStore.getState().changeSets).toHaveLength(0)
    expect(useDirectEditOfferStore.getState().offer).toBeNull()
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe('Document changed — check cancelled')
  })

  it('Check on a drifted block makes ZERO propose calls and withdraws the offer', async () => {
    const state = EditorState.create({ schema, doc: DOC })
    const offer = offerFor(state.doc)
    useDirectEditOfferStore.getState().setOffer(offer)

    // The block kept changing after the offer was computed.
    const range = blockTextRange(state.doc, 'b1', '$75,000')!
    const drifted = state.apply(state.tr.replaceWith(range.from, range.to, schema.text('$80,000')))

    const propose = vi.fn(async () => [fakeCascade(state.doc)])
    await runDirectEditCascade({ state: drifted }, offer, propose as unknown as ProposeCascadesFn)

    expect(propose).not.toHaveBeenCalled()
    expect(useAnnotationStore.getState().annotations).toHaveLength(0)
    expect(useDirectEditOfferStore.getState().offer).toBeNull()
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe('This section changed — offer withdrawn')
  })

  it('Check on a vanished block makes ZERO propose calls and withdraws the offer', async () => {
    // Only b2 remains — the offered block is gone entirely.
    const shrunk = schema.node('doc', null, [
      p('b2', 'Marketing may spend at most ten percent of the Total Budget in any quarter.'),
    ])
    const state = EditorState.create({ schema, doc: shrunk })
    const offer = offerFor(DOC)
    useDirectEditOfferStore.getState().setOffer(offer)

    const propose = vi.fn(async () => [])
    await runDirectEditCascade({ state }, offer, propose as unknown as ProposeCascadesFn)

    expect(propose).not.toHaveBeenCalled()
    expect(useDirectEditOfferStore.getState().offer).toBeNull()
    expect(useToastStore.getState().toasts[0]?.message).toBe('This section changed — offer withdrawn')
  })
})
