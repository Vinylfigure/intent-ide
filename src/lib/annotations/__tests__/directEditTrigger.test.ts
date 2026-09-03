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
import { useSettingsStore } from '@/stores/settingsStore'
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
  useDirectEditOfferStore.getState().clearRenameOffer()
  useSettingsStore.getState().setConsistencyCheckMode('commit')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('settleDirectEdits — offer path', () => {
  it('offers the human-edited block with beforeText, current range, and graph dependents — zero network', async () => {
    let state = stateOf(fixtureDoc())
    resetDirectEditBaseline(state.doc)

    state = humanEdit(state, 'b1', '$50,000', '$75,000')

    const offer = (await settleDirectEdits(state)).dependentOffer
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

    expect((await settleDirectEdits(state)).dependentOffer).not.toBeNull()
    expect((await settleDirectEdits(state)).dependentOffer).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns null with no pending touches (and just refreshes the baseline)', async () => {
    const state = stateOf(fixtureDoc())
    resetDirectEditBaseline(state.doc)
    expect((await settleDirectEdits(state)).dependentOffer).toBeNull()
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

      expect((await settleDirectEdits(next)).dependentOffer).toBeNull()
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

    expect((await settleDirectEdits(next)).dependentOffer).toBeNull()
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

    const offer = (await settleDirectEdits(state)).dependentOffer
    expect(offer?.blockId).toBe('b1')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('settleDirectEdits — graph gating and reset', () => {
  it('returns null for an edited block with no graph neighbors', async () => {
    let state = stateOf(fixtureDoc())
    resetDirectEditBaseline(state.doc)

    state = humanEdit(state, 'iso', 'alternating Tuesdays', 'even-numbered Fridays')

    expect((await settleDirectEdits(state)).dependentOffer).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('picks the changed block with the largest text delta among several touches', async () => {
    let state = stateOf(fixtureDoc())
    resetDirectEditBaseline(state.doc)

    state = humanEdit(state, 'b2', 'ten', 'six')
    state = humanEdit(state, 'b1', '$50,000 allocated', '$75,000 provisionally earmarked')

    const offer = (await settleDirectEdits(state)).dependentOffer
    expect(offer?.blockId).toBe('b1')
  })

  it('resetDirectEditBaseline clears pending touches (doc switch)', async () => {
    let state = stateOf(fixtureDoc())
    resetDirectEditBaseline(state.doc)

    state = humanEdit(state, 'b1', '$50,000', '$75,000')
    resetDirectEditBaseline(state.doc)

    expect((await settleDirectEdits(state)).dependentOffer).toBeNull()
  })

  it('a touched block whose text is unchanged by settle time (edit typed then reverted) is not offered', async () => {
    let state = stateOf(fixtureDoc())
    resetDirectEditBaseline(state.doc)

    state = humanEdit(state, 'b1', '$50,000', '$75,000')
    state = humanEdit(state, 'b1', '$75,000', '$50,000') // hand-reverted

    expect((await settleDirectEdits(state)).dependentOffer).toBeNull()
  })
})

describe('acceptSettledOffer — doc-switch race + stale-offer invalidation', () => {
  async function settledOffer(): Promise<DirectEditOffer> {
    let state = stateOf(fixtureDoc())
    resetDirectEditBaseline(state.doc)
    state = humanEdit(state, 'b1', '$50,000', '$75,000')
    const offer = (await settleDirectEdits(state)).dependentOffer
    expect(offer).not.toBeNull()
    return offer as DirectEditOffer
  }

  it('surfaces an offer stamped for the still-active document', async () => {
    const offer = await settledOffer()
    acceptSettledOffer({ dependentOffer: offer, renameOffer: null })
    expect(useDirectEditOfferStore.getState().offer).toBe(offer)
  })

  it('a settle resolving AFTER a doc switch does not surface its offer (and clears any lingering one)', async () => {
    const offer = await settledOffer() // stamped doc-A
    // The user switches documents before the async settle result lands.
    useDocumentStore.setState({ activeDocumentId: 'doc-B' })
    acceptSettledOffer({ dependentOffer: offer, renameOffer: null })
    expect(useDirectEditOfferStore.getState().offer).toBeNull()
  })

  it('a null settle clears a previously surfaced offer instead of leaving it up (stale-offer invalidation)', async () => {
    const offer = await settledOffer()
    acceptSettledOffer({ dependentOffer: offer, renameOffer: null })
    expect(useDirectEditOfferStore.getState().offer).not.toBeNull()

    // Next settle window produces nothing — the old chip must come down.
    acceptSettledOffer({ dependentOffer: null, renameOffer: null })
    expect(useDirectEditOfferStore.getState().offer).toBeNull()
  })
})


describe('settleDirectEdits — the rename arm', () => {
  // A bare name mention creates no cross-reference, no defined term and no
  // duplicated sentence, so it produces no graph edge at all. That is why
  // changing "Cody" to "Joe" used to raise nothing: the only arm that existed
  // required graph dependents.

  function renameDoc(): PMNode {
    return docOf(
      p('r1', 'Cody owns the runbook.'),
      p('r2', 'Ask Cody about IAM before shipping.'),
      p('r3', 'The reviewer wrote "Cody signed this off" in the margin.'),
      p('big', 'Office plants are watered on alternating Tuesdays.'),
    )
  }

  it('offers a rename that the graph could never have seen', () => {
    let state = stateOf(renameDoc())
    resetDirectEditBaseline(state.doc)
    state = humanEdit(state, 'r1', 'Cody', 'Joe')

    return settleDirectEdits(state).then((result) => {
      expect(result.renameOffer).toMatchObject({ from: 'Cody', to: 'Joe' })
      // r2 only. r3's mention sits inside a quotation and is never offered.
      expect(result.renameOffer?.occurrenceCount).toBe(1)
      expect(result.renameOffer?.targets.map((t) => t.blockId)).toEqual(['r2'])
    })
  })

  it('finds a rename in a block that did NOT win the biggest-delta race', async () => {
    // The regression. settleDirectEdits picks a single winner by edit size for
    // the dependent arm; a rename arm bolted onto that selection would be
    // masked by any larger unrelated edit in the same settle window — and a
    // window containing more than one edit is the normal case.
    let state = stateOf(renameDoc())
    resetDirectEditBaseline(state.doc)
    state = humanEdit(state, 'r1', 'Cody', 'Joe')
    state = humanEdit(
      state,
      'big',
      'Office plants are watered on alternating Tuesdays.',
      'Office plants are watered on alternating Tuesdays, except during the winter shutdown when the facilities team handles them instead.',
    )

    const result = await settleDirectEdits(state)
    expect(result.renameOffer).toMatchObject({ from: 'Cody', to: 'Joe' })
  })

  it('treats the same rename made twice before the settle as one rename', async () => {
    // The other regression: a character-level prefix/suffix diff would span
    // both edits plus everything between them and reject this as a rewrite —
    // exactly when the reader has already shown they expect propagation.
    let state = stateOf(
      docOf(
        p('m1', 'Cody owns the runbook. Ask Cody before changing it.'),
        p('m2', 'Escalate to Cody when the pipeline stalls.'),
      ),
    )
    resetDirectEditBaseline(state.doc)
    state = humanEdit(
      state,
      'm1',
      'Cody owns the runbook. Ask Cody before changing it.',
      'Joe owns the runbook. Ask Joe before changing it.',
    )

    const result = await settleDirectEdits(state)
    expect(result.renameOffer).toMatchObject({ from: 'Cody', to: 'Joe', occurrenceCount: 1 })
  })

  it('stays quiet on ordinary rewriting', async () => {
    let state = stateOf(renameDoc())
    resetDirectEditBaseline(state.doc)
    state = humanEdit(state, 'r2', 'before shipping', 'before the release goes out')

    const result = await settleDirectEdits(state)
    expect(result.renameOffer).toBeNull()
  })

  it('stays quiet when the renamed name appears nowhere else', async () => {
    let state = stateOf(docOf(p('s1', 'Cody owns the runbook.'), p('s2', 'Unrelated text.')))
    resetDirectEditBaseline(state.doc)
    state = humanEdit(state, 's1', 'Cody', 'Joe')

    const result = await settleDirectEdits(state)
    expect(result.renameOffer).toBeNull()
  })

  it('makes no network call before the reader consents', async () => {
    // The module's existing data-egress guarantee must survive the new arm.
    let state = stateOf(renameDoc())
    resetDirectEditBaseline(state.doc)
    state = humanEdit(state, 'r1', 'Cody', 'Joe')

    await settleDirectEdits(state)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('surfaces the rename offer through acceptSettledOffer, and drops it after a doc switch', async () => {
    let state = stateOf(renameDoc())
    resetDirectEditBaseline(state.doc)
    state = humanEdit(state, 'r1', 'Cody', 'Joe')
    const result = await settleDirectEdits(state)

    acceptSettledOffer(result)
    expect(useDirectEditOfferStore.getState().renameOffer).toMatchObject({ from: 'Cody' })

    useDocumentStore.setState({ activeDocumentId: 'doc-B' })
    acceptSettledOffer(result)
    expect(useDirectEditOfferStore.getState().renameOffer).toBeNull()
  })
})

describe('settleDirectEdits — consistencyCheckMode gate', () => {
  it('produces nothing at all when background checking is off', async () => {
    useSettingsStore.getState().setConsistencyCheckMode('off')
    let state = stateOf(fixtureDoc())
    resetDirectEditBaseline(state.doc)
    state = humanEdit(state, 'b1', '$50,000', '$75,000')

    const result = await settleDirectEdits(state)
    expect(result).toEqual({ dependentOffer: null, renameOffer: null })
  })

  it('produces nothing on demand-only, where checks are explicit', async () => {
    useSettingsStore.getState().setConsistencyCheckMode('demand')
    let state = stateOf(fixtureDoc())
    resetDirectEditBaseline(state.doc)
    state = humanEdit(state, 'b1', '$50,000', '$75,000')

    expect(await settleDirectEdits(state)).toEqual({ dependentOffer: null, renameOffer: null })
  })
})
