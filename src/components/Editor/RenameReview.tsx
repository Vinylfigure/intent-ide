'use client'

import { useCallback, useMemo, useState } from 'react'
import { useDirectEditOfferStore } from '@/stores/directEditOfferStore'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useToastStore } from '@/stores/toastStore'
import { findBlockById } from '@/lib/prosemirror/blockIds'
import { applySingleEdit } from '@/lib/prosemirror/applyProposedEdits'
import { judgeRenameOccurrences, type RenameVerdict } from '@/lib/ai/judgeRenameOccurrences'
import { generateId } from '@/lib/utils/id'

/**
 * Review the mentions a rename left behind — one at a time, with the sentence.
 *
 * Nothing here auto-applies. Prose has no compiler: coreference resolution runs
 * at roughly F1 78-81% on curated benchmarks and worse on real documents, and
 * its failure cases are exactly the ones that matter (a different person with
 * the same name, a product, a quotation). Every tool that does this well —
 * IntelliJ's rename preview, Vale, Acrolinx, textlint — suggests and never
 * silently commits, because one wrong rewrite costs more trust than one extra
 * confirmation click.
 *
 * One at a time rather than a grid of checkboxes, for the reason `git add -p`
 * is tolerable and a wall of N decisions is not: each item is judged in its own
 * context, the common case is a single keystroke, and the ambiguous ones are
 * the only ones that cost real attention.
 */

interface ReviewItem {
  blockId: string
  index: number
  sentence: string
  verdict?: RenameVerdict
}

export function RenameReview() {
  const offer = useDirectEditOfferStore((s) => s.renameOffer)
  const clearRenameOffer = useDirectEditOfferStore((s) => s.clearRenameOffer)
  const [items, setItems] = useState<ReviewItem[] | null>(null)
  const [cursor, setCursor] = useState(0)
  const [busy, setBusy] = useState(false)
  const [applied, setApplied] = useState(0)

  const flattened = useMemo<ReviewItem[]>(() => {
    if (!offer) return []
    return offer.targets.flatMap((target) =>
      target.occurrences.map((o) => ({
        blockId: target.blockId,
        index: o.index,
        sentence: o.sentence,
      })),
    )
  }, [offer])

  const close = useCallback(() => {
    setItems(null)
    setCursor(0)
    setApplied(0)
    clearRenameOffer()
  }, [clearRenameOffer])

  const startReview = useCallback(async () => {
    if (!offer || busy) return
    setBusy(true)
    try {
      // The judge is opt-in in the same way the related-passage second opinion
      // is. With it off, every candidate is simply reviewed unjudged — the
      // reader still decides, they just get no hint.
      if (useSettingsStore.getState().judgeEnabled) {
        const config = useSettingsStore.getState().llmConfig
        const verdicts = await judgeRenameOccurrences(
          { from: offer.from, to: offer.to },
          flattened.map((i) => ({ sentence: i.sentence })),
          config,
        )
        setItems(flattened.map((item, i) => ({ ...item, verdict: verdicts.get(i) })))
      } else {
        setItems(flattened)
      }
    } catch {
      // A judge failure must never destroy the first opinion — show every
      // candidate unjudged rather than deciding for the reader.
      setItems(flattened)
    } finally {
      setBusy(false)
    }
  }, [offer, flattened, busy])

  const applyCurrent = useCallback(
    (item: ReviewItem) => {
      const view = useEditorStore.getState().view
      if (!view || !offer) return false
      const block = findBlockById(view.state.doc, item.blockId)
      if (!block) return false
      const from = block.pos + 1 + item.index
      const result = applySingleEdit(view, {
        id: generateId(),
        from,
        to: from + offer.from.length,
        newText: offer.to,
        // Fail closed: applySingleEdit re-verifies this text at the range and
        // recovers by block-scoped fingerprint if the document moved under us.
        targetText: offer.from,
        blockId: item.blockId,
      })
      if (!result.ok) {
        useToastStore.getState().addToast(result.reason, 'error')
        return false
      }
      return result.applied.length > 0
    },
    [offer],
  )

  const decide = useCallback(
    (rename: boolean) => {
      if (!items) return
      const item = items[cursor]
      if (rename && item && applyCurrent(item)) setApplied((n) => n + 1)
      if (cursor + 1 >= items.length) {
        useToastStore
          .getState()
          .addToast(
            `${applied + (rename ? 1 : 0)} of ${items.length} renamed`,
            'success',
          )
        close()
        return
      }
      setCursor((n) => n + 1)
    },
    [items, cursor, applyCurrent, applied, close],
  )

  if (!offer) return null

  // ── The quiet offer chip ──────────────────────────────────────────────────
  if (!items) {
    const noun = offer.occurrenceCount === 1 ? 'other mention' : 'other mentions'
    return (
      <div
        role="status"
        aria-label={`You renamed ${offer.from} to ${offer.to} — offer to review ${offer.occurrenceCount} ${noun}`}
        className="fixed bottom-20 right-6 z-40 flex max-w-md items-center gap-2 rounded-full border border-stone-200 bg-white/95 px-4 py-2 text-sm text-stone-700 shadow-md backdrop-blur"
      >
        {busy ? (
          <span className="italic text-stone-500">Checking other mentions…</span>
        ) : (
          <>
            <span className="truncate">
              {offer.from} → {offer.to}: {offer.occurrenceCount} {noun}
            </span>
            <button
              type="button"
              onClick={startReview}
              aria-label={`Review ${offer.occurrenceCount} ${noun}`}
              className="shrink-0 rounded-full bg-stone-800 px-3 py-1 text-xs font-medium text-white hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-500"
            >
              Review
            </button>
            <button
              type="button"
              onClick={close}
              aria-label="Dismiss this rename suggestion"
              className="shrink-0 rounded-full px-2 py-1 text-xs text-stone-500 hover:bg-stone-100 hover:text-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-400"
            >
              Dismiss
            </button>
          </>
        )}
      </div>
    )
  }

  // ── One mention at a time, with its sentence ──────────────────────────────
  const item = items[cursor]
  if (!item) return null
  const confident = item.verdict?.sameReferent === true

  return (
    <div
      role="dialog"
      aria-label={`Rename review, mention ${cursor + 1} of ${items.length}`}
      className="fixed bottom-20 right-6 z-40 w-[26rem] max-w-[calc(100vw-3rem)] rounded-xl border border-stone-200 bg-white/98 p-4 text-sm shadow-lg backdrop-blur"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-stone-800">
          {offer.from} → {offer.to}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-stone-500">
          {cursor + 1} of {items.length}
        </span>
      </div>

      <p className="mt-3 rounded-md bg-stone-50 px-3 py-2 leading-relaxed text-stone-700">
        {item.sentence}
      </p>

      {item.verdict && (
        <p className={`mt-2 text-xs ${confident ? 'text-stone-600' : 'text-amber-700'}`}>
          {confident ? '✓ ' : '⚠ '}
          {item.verdict.reason}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => decide(true)}
          className="rounded-md bg-stone-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-500"
        >
          Rename this
        </button>
        <button
          type="button"
          onClick={() => decide(false)}
          className="rounded-md px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-stone-400"
        >
          Leave it
        </button>
        <button
          type="button"
          onClick={close}
          className="ml-auto rounded-md px-2 py-1.5 text-xs text-stone-500 hover:bg-stone-100 hover:text-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-400"
        >
          Stop
        </button>
      </div>
    </div>
  )
}
