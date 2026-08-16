import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'
import { blockTextRange } from '@/lib/prosemirror/blockIds'
import { blockIdPluginKey } from '@/lib/prosemirror/plugins/blockIdPlugin'
import { changeTrackingPluginKey } from '@/lib/prosemirror/plugins/changeTrackingPlugin'
import { AI_APPLY_META } from '@/lib/prosemirror/applyProposedEdits'
import { invalidateDocGraphCache } from '@/lib/graphrag/docGraph'
import { useDocumentStore } from '@/stores/documentStore'
import { useDirectEditOfferStore } from '@/stores/directEditOfferStore'
import {
  acceptSettledOffer,
  observeTransaction,
  resetDirectEditBaseline,
  settleDirectEdits,
  type DirectEditOffer,
} from '../directEditTrigger'

function p(blockId: string | null, text: string): PMNode {
  return schema.node('paragraph', { blockId }, [schema.text(text)])
}

function docOf(...blocks: PMNode[]): PMNode {
  return schema.node('doc', null, blocks)
}

// Deterministic-graph fixture (defined-term pattern, as in the docGraph and
// cascade e2e suites): b1 defines "Total Budget"; b2 uses the term, so the
// deterministic pass links b2 → b1 with NO model involved. iso is unlinked.
function fixtureDoc(): PMNode {
  return docOf(
    p('b1', '"Total Budget" means $50,000 allocated for the 2026 pilot program.'),
    p('b2', 'Marketing may spend at most ten percent of the Total Budget in any quarter.'),
    p('iso', 'Office plants are watered on alternating Tuesdays.'),
  )
}

function stateOf(doc: PMNode): EditorState {
  return EditorState.create({ schema, doc })
}

/** Apply a human typing tr replacing `target` in `blockId` and observe it. */
function humanEdit(state: EditorState, blockId: string, target: string, replacement: string): EditorState {
  const range = blockTextRange(state.doc, blockId, target)
  if (!range) throw new Error(`fixture bug: "${target}" not in ${blockId}`)
  const tr = state.tr.replaceWith(range.from, range.to, schema.text(replacement))
  const next = state.apply(tr)
  observeTransaction(tr, next.doc)
  return next
}

// The data-egress guarantee is load-bearing: any network attempt before the
// user consents must FAIL the suite, not just be counted.
const fetchSpy = vi.fn(() => {
  throw new Error('direct-edit trigger made a network call — data-egress violation')
})

beforeEach(() => {
  invalidateDocGraphCache()
  vi.stubGlobal('fetch', fetchSpy)
  fetchSpy.mockClear()
  useDocumentStore.setState({ activeDocumentId: 'doc-A' })
  useDirectEditOfferStore.getState().clearOffer()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('settleDirectEdits — offer path', () => {
  it('offers the human-edited block with beforeText, current range, and graph dependents — zero network', async () => {
    let state = stateOf(fixtureDoc())
    resetDirectEditBaseline(state.doc)

    state = humanEdit(state, 'b1', '$50,000', '$75,000')

    const offer = await settleDirectEdits(state)
    expect(offer).not.toBeNull()
    const o = offer as DirectEditOffer
    expect(o.blockId).toBe('b1')
    expect(o.beforeText).toBe('"Total Budget" means $50,000 allocated for the 2026 pilot program.')
    expect(o.blockText).toBe('"Total Budget" means $75,000 allocated for the 2026 pilot program.')
    // b2 references the defined term → at least one dependent.
    expect(o.dependentCount).toBeGreaterThan(0)
    // from/to span the block's CURRENT content.
    expect(state.doc.textBetween(o.from, o.to)).toBe(o.blockText)
    // The offer carries the settle-time document id.
    expect(o.documentId).toBe('doc-A')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a settle consumes the pending touches — the next settle is null', async () => {
    let state = stateOf(fixtureDoc())
    resetDirectEditBaseline(state.doc)
    state = humanEdit(state, 'b1', '$50,000', '$75,000')

    expect(await settleDirectEdits(state)).not.toBeNull()
    expect(await settleDirectEdits(state)).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns null with no pending touches (and just refreshes the baseline)', async () => {
    const state = stateOf(fixtureDoc())
    resetDirectEditBaseline(state.doc)
    expect(await settleDirectEdits(state)).toBeNull()
  })
})

describe('settleDirectEdits — skip contract (changeTrackingPlugin parity + AI stamp)', () => {
  const SKIP_METAS: Array<[string, (tr: import('prosemirror-state').Transaction) => void]> = [
    ['history$ (undo/redo)', (tr) => tr.setMeta('history$', {})],
    ['blockIdPluginKey (id stamping)', (tr) => tr.setMeta(blockIdPluginKey, { stamped: true })],
    ['changeTrackingPluginKey (tracking tag)', (tr) => tr.setMeta(changeTrackingPluginKey, { changeId: 'x' })],
    ['addToHistory:false (state load)', (tr) => tr.setMeta('addToHistory', false)],
    ['AI_APPLY_META (batched AI apply)', (tr) => tr.setMeta(AI_APPLY_META, true)],
  ]

  for (const [label, stamp] of SKIP_METAS) {
    it(`ignores a doc-changing transaction carrying ${label}`, async () => {
      const state = stateOf(fixtureDoc())
      resetDirectEditBaseline(state.doc)

      const range = blockTextRange(state.doc, 'b1', '$50,000')!
      const tr = state.tr.replaceWith(range.from, range.to, schema.text('$75,000'))
      stamp(tr)
      const next = state.apply(tr)
      observeTransaction(tr, next.doc)

      expect(await settleDirectEdits(next)).toBeNull()
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  }

  it('a single AI replaceWith stamped with AI_APPLY_META (ResolutionActions / ConversationThread apply shape) records no human touch', async () => {
    // These two apply sites dispatch one plain replaceWith (not the batched
    // applyProposedEdits path) — the stamp alone must keep them out of the
    // direct-edit offer.
    const state = stateOf(fixtureDoc())
    resetDirectEditBaseline(state.doc)

    const range = blockTextRange(state.doc, 'b1', '$50,000')!
    const tr = state.tr.replaceWith(range.from, range.to, schema.text('$99,000'))
    tr.setMeta(AI_APPLY_META, true)
    const next = state.apply(tr)
    observeTransaction(tr, next.doc)

    expect(await settleDirectEdits(next)).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('mixed session: AI-stamped change in b2 + human change in b1 → offer only for b1', async () => {
    let state = stateOf(fixtureDoc())
    resetDirectEditBaseline(state.doc)

    // AI apply mutates b2 (bigger delta than the human edit — would win the
    // largest-delta pick if it were wrongly tracked).
    const aiRange = blockTextRange(state.doc, 'b2', 'at most ten percent')!
    const aiTr = state.tr.replaceWith(
      aiRange.from,
      aiRange.to,
      schema.text('no more than twenty-five percent, reviewed monthly,'),
    )
    aiTr.setMeta(AI_APPLY_META, true)
    state = state.apply(aiTr)
    observeTransaction(aiTr, state.doc)

    state = humanEdit(state, 'b1', '$50,000', '$75,000')

    const offer = await settleDirectEdits(state)
    expect(offer?.blockId).toBe('b1')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('settleDirectEdits — graph gating and reset', () => {
  it('returns null for an edited block with no graph neighbors', async () => {
    let state = stateOf(fixtureDoc())
    resetDirectEditBaseline(state.doc)

    state = humanEdit(state, 'iso', 'alternating Tuesdays', 'even-numbered Fridays')

    expect(await settleDirectEdits(state)).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('picks the changed block with the largest text delta among several touches', async () => {
    let state = stateOf(fixtureDoc())
    resetDirectEditBaseline(state.doc)

    state = humanEdit(state, 'b2', 'ten', 'six')
    state = humanEdit(state, 'b1', '$50,000 allocated', '$75,000 provisionally earmarked')

    const offer = await settleDirectEdits(state)
    expect(offer?.blockId).toBe('b1')
  })

  it('resetDirectEditBaseline clears pending touches (doc switch)', async () => {
    let state = stateOf(fixtureDoc())
    resetDirectEditBaseline(state.doc)

    state = humanEdit(state, 'b1', '$50,000', '$75,000')
    resetDirectEditBaseline(state.doc)

    expect(await settleDirectEdits(state)).toBeNull()
  })

  it('a touched block whose text is unchanged by settle time (edit typed then reverted) is not offered', async () => {
    let state = stateOf(fixtureDoc())
    resetDirectEditBaseline(state.doc)

    state = humanEdit(state, 'b1', '$50,000', '$75,000')
    state = humanEdit(state, 'b1', '$75,000', '$50,000') // hand-reverted

    expect(await settleDirectEdits(state)).toBeNull()
  })
})

describe('acceptSettledOffer — doc-switch race + stale-offer invalidation', () => {
  async function settledOffer(): Promise<DirectEditOffer> {
    let state = stateOf(fixtureDoc())
    resetDirectEditBaseline(state.doc)
    state = humanEdit(state, 'b1', '$50,000', '$75,000')
    const offer = await settleDirectEdits(state)
    expect(offer).not.toBeNull()
    return offer as DirectEditOffer
  }

  it('surfaces an offer stamped for the still-active document', async () => {
    const offer = await settledOffer()
    acceptSettledOffer(offer)
    expect(useDirectEditOfferStore.getState().offer).toBe(offer)
  })

  it('a settle resolving AFTER a doc switch does not surface its offer (and clears any lingering one)', async () => {
    const offer = await settledOffer() // stamped doc-A
    // The user switches documents before the async settle result lands.
    useDocumentStore.setState({ activeDocumentId: 'doc-B' })
    acceptSettledOffer(offer)
    expect(useDirectEditOfferStore.getState().offer).toBeNull()
  })

  it('a null settle clears a previously surfaced offer instead of leaving it up (stale-offer invalidation)', async () => {
    const offer = await settledOffer()
    acceptSettledOffer(offer)
    expect(useDirectEditOfferStore.getState().offer).not.toBeNull()

    // Next settle window produces nothing — the old chip must come down.
    acceptSettledOffer(null)
    expect(useDirectEditOfferStore.getState().offer).toBeNull()
  })
})
