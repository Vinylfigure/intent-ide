import type { Node as PMNode } from 'prosemirror-model'
import type { EditorState, Transaction } from 'prosemirror-state'
import { blockIdAtPos, collectTextblocks, findBlockById } from '@/lib/prosemirror/blockIds'
import { AI_APPLY_META } from '@/lib/prosemirror/applyProposedEdits'
import { blockIdPluginKey } from '@/lib/prosemirror/plugins/blockIdPlugin'
import { changeTrackingPluginKey } from '@/lib/prosemirror/plugins/changeTrackingPlugin'
import { getDocGraph, getNeighborhood } from '@/lib/graphrag/docGraph'
import { useSettingsStore } from '@/stores/settingsStore'
import { useDocumentStore } from '@/stores/documentStore'
import { useDirectEditOfferStore } from '@/stores/directEditOfferStore'
import { detectRename, offerableOccurrences, type Occurrence } from './renameDetect'

/**
 * Direct-edit cascade trigger (Flow v1 P4, issue #17).
 *
 * Watches HUMAN typing (module-singleton tracker fed from EditorShell's
 * dispatchTransaction), and at the autosave settle point diffs the touched
 * blocks against a baseline snapshot. When a settled human edit lands in a
 * block that has dependents in the DETERMINISTIC document graph, it produces a
 * quiet OFFER ("You changed X — check N dependent sections?").
 *
 * Hard rules this module enforces by construction:
 * - HITL: it only ever returns an offer object; it never proposes, previews,
 *   or applies edits.
 * - Data egress: everything here is computed from the deterministic graph
 *   (`skipLlm` + `skipEmbeddings` + `skipGraphiti`) — ZERO network/LLM calls
 *   happen before the user consents by clicking Check.
 */

export interface DirectEditOffer {
  /**
   * Document the offer was computed against, stamped at settle entry. Settle
   * and the post-consent cascade both await across possible doc switches —
   * consumers must drop the offer when this no longer matches the active
   * document (see acceptSettledOffer / runDirectEditCascade).
   */
  documentId: string
  blockId: string
  /** The block's CURRENT (post-edit) text. */
  blockText: string
  /** The block's text at the last settle/reset baseline. */
  beforeText: string
  /** Current content range of the block (from/to around its text). */
  from: number
  to: number
  /** Graph dependents within 2 hops (excluding the block itself). */
  dependentCount: number
}

/** blockId → text snapshot; null until the first reset/settle captures one. */
let baseline: Map<string, string> | null = null
let humanTouchedBlockIds = new Set<string>()

function snapshot(doc: PMNode): Map<string, string> {
  const map = new Map<string, string>()
  for (const b of collectTextblocks(doc)) {
    if (b.blockId) map.set(b.blockId, b.node.textContent)
  }
  return map
}

/** Re-capture the baseline and drop any pending touches (doc load/switch). */
export function resetDirectEditBaseline(doc: PMNode): void {
  baseline = snapshot(doc)
  humanTouchedBlockIds = new Set()
}

/**
 * True when a transaction is NOT a settled human edit. Replicates
 * changeTrackingPlugin's skip contract (see changeTrackingPlugin.ts:55-61 —
 * history$, blockId stamps, change-tracking tags, addToHistory:false state
 * loads; if that skip list changes, update BOTH places), plus the AI apply
 * stamp so applying an AI cascade never re-offers a cascade on itself.
 * Every AI-write dispatch carries AI_APPLY_META — the batched apply
 * (applyProposedEdits), ResolutionActions' single-suggestedEdit apply and
 * content-insert paths, and ConversationThread's per-message apply. A new
 * AI-write site MUST stamp the meta too, or its edits will surface spurious
 * direct-edit offers.
 */
function shouldSkip(tr: Transaction): boolean {
  return Boolean(
    tr.getMeta('history$') ||
      tr.getMeta(blockIdPluginKey) ||
      tr.getMeta(changeTrackingPluginKey) ||
      tr.getMeta('addToHistory') === false ||
      tr.getMeta(AI_APPLY_META),
  )
}

/**
 * Record which blocks a (human) transaction touched. Called from
 * dispatchTransaction AFTER updateState with the post-apply doc.
 */
export function observeTransaction(tr: Transaction, newDoc: PMNode): void {
  if (!tr.docChanged || shouldSkip(tr)) return

  tr.steps.forEach((step, i) => {
    // Positions after the remaining steps of THIS transaction.
    const rest = tr.mapping.slice(i + 1)
    step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      const from = rest.map(newStart)
      const to = rest.map(newEnd, -1)
      for (const pos of from === to ? [from] : [from, Math.max(from, to - 1)]) {
        const blockId = blockIdAtPos(newDoc, pos)
        if (blockId) humanTouchedBlockIds.add(blockId)
      }
    })
  })
}

/** Cheap edit-size metric: chars outside the common prefix + suffix. */
function textDelta(before: string, after: string): number {
  let prefix = 0
  const max = Math.min(before.length, after.length)
  while (prefix < max && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (
    suffix < max - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++
  }
  return before.length - prefix - suffix + (after.length - prefix - suffix)
}

/**
 * A rename the reader made, and everywhere the old name still stands.
 *
 * Separate from DirectEditOffer because it is found a different way: the
 * dependent-section offer needs the doc graph, while a rename is visible in the
 * text alone. A bare name mention creates no cross-reference, no defined term
 * and no duplicated sentence, so it produces NO graph edge — which is exactly
 * why changing "Cody" to "Joe" used to raise nothing at all.
 */
export interface RenameTarget {
  blockId: string
  occurrences: Occurrence[]
}

export interface RenameOffer {
  documentId: string
  /** The block the reader actually edited. */
  blockId: string
  from: string
  to: string
  /** Blocks elsewhere that still carry the old name, with their sentences. */
  targets: RenameTarget[]
  occurrenceCount: number
}

export interface SettleResult {
  dependentOffer: DirectEditOffer | null
  renameOffer: RenameOffer | null
}

const EMPTY_SETTLE: SettleResult = { dependentOffer: null, renameOffer: null }

/**
 * Scan EVERY touched block for a rename.
 *
 * Deliberately not folded into the biggest-delta selection below. That
 * selection picks one winner across all touched blocks, so a large unrelated
 * rewrite in one block would mask a small rename in another — and a settle
 * window containing more than one edit is the normal case, not an edge case.
 *
 * Pure and synchronous: text in, offer out. No graph, no network.
 */
function scanForRename(
  documentId: string,
  touched: Set<string>,
  prior: Map<string, string>,
  current: Map<string, string>,
): RenameOffer | null {
  for (const blockId of touched) {
    const beforeText = prior.get(blockId)
    const text = current.get(blockId)
    if (beforeText === undefined || text === undefined || beforeText === text) continue

    const candidate = detectRename(beforeText, text)
    if (!candidate) continue

    const targets: RenameTarget[] = []
    let occurrenceCount = 0
    for (const [otherId, otherText] of current) {
      if (otherId === blockId) continue
      const occurrences = offerableOccurrences(otherText, candidate.from)
      if (occurrences.length === 0) continue
      targets.push({ blockId: otherId, occurrences })
      occurrenceCount += occurrences.length
    }
    // The reader renamed the only mention there was. Nothing to offer.
    if (occurrenceCount === 0) continue

    // One offer at a time — the chip says one thing, and two competing renames
    // in a single settle window is not a case worth a queue.
    return { documentId, blockId, from: candidate.from, to: candidate.to, targets, occurrenceCount }
  }
  return null
}

/**
 * Settle point (autosave flush): diff touched blocks against the baseline and
 * produce up to two independent offers —
 *
 *   - a RENAME offer, from any touched block whose edit was a name swap;
 *   - a DEPENDENT-SECTION offer, from the single biggest changed block, when
 *     the deterministic graph says it has dependents.
 *
 * Always refreshes the baseline and clears the touch set — each settle window
 * is independent. Deterministic graph only; zero network by construction.
 */
export async function settleDirectEdits(state: EditorState): Promise<SettleResult> {
  const doc = state.doc
  const touched = humanTouchedBlockIds
  const prior = baseline
  // Stamp the settle-time document — the graph await below can race a doc
  // switch, and an offer must carry the document it was computed against.
  const documentId = useDocumentStore.getState().activeDocumentId ?? 'unknown'

  // Every settle starts the next window fresh, whatever we return.
  const current = snapshot(doc)
  baseline = current
  humanTouchedBlockIds = new Set()

  // No baseline yet (fresh module) or nothing human-touched → nothing to offer.
  if (!prior || touched.size === 0) return EMPTY_SETTLE

  // The reader can switch background checking off entirely. Checked here rather
  // than at the call site so no arm can be added later that forgets to ask.
  if (useSettingsStore.getState().consistencyCheckMode !== 'commit') return EMPTY_SETTLE

  const renameOffer = scanForRename(documentId, touched, prior, current)

  let best: { blockId: string; beforeText: string; text: string; delta: number } | null = null
  for (const blockId of touched) {
    const beforeText = prior.get(blockId)
    const text = current.get(blockId)
    // Block is new since baseline, vanished, or unchanged → not offerable.
    if (beforeText === undefined || text === undefined || beforeText === text) continue
    const delta = textDelta(beforeText, text)
    if (!best || delta > best.delta) best = { blockId, beforeText, text, delta }
  }
  if (!best) return { dependentOffer: null, renameOffer }

  // Deterministic graph only — matches what scheduleDocGraphRebuild primes,
  // so this is usually a warm cache hit and NEVER a network call.
  const config = useSettingsStore.getState().llmConfig
  const graph = await getDocGraph(doc, config, {
    skipLlm: true,
    skipEmbeddings: true,
    skipGraphiti: true,
  })
  const dependentCount = getNeighborhood(graph, best.blockId, 2).size - 1
  if (dependentCount <= 0) return { dependentOffer: null, renameOffer }

  const live = findBlockById(doc, best.blockId)
  if (!live || !live.node.isTextblock) return { dependentOffer: null, renameOffer }

  return {
    dependentOffer: {
      documentId,
      blockId: best.blockId,
      blockText: best.text,
      beforeText: best.beforeText,
      from: live.pos + 1,
      to: live.pos + 1 + live.node.content.size,
      dependentCount,
    },
    renameOffer,
  }
}

/**
 * Resolution-time sink for a settled result (EditorShell's autosave callback).
 * ALWAYS writes the stores from the settle result: a real offer for the still-
 * active document is surfaced; a null settle or an offer stamped for another
 * document (settle resolved after a doc switch) CLEARS any offer instead of
 * leaving a stale chip up.
 */
export function acceptSettledOffer(result: SettleResult): void {
  const store = useDirectEditOfferStore.getState()
  const activeId = useDocumentStore.getState().activeDocumentId

  const { dependentOffer, renameOffer } = result
  if (dependentOffer && dependentOffer.documentId === activeId) {
    store.setOffer(dependentOffer)
  } else {
    store.clearOffer()
  }

  if (renameOffer && renameOffer.documentId === activeId) {
    store.setRenameOffer(renameOffer)
  } else {
    store.clearRenameOffer()
  }
}
