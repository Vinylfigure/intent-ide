'use client'

import { useCallback } from 'react'
import { useDirectEditOfferStore } from '@/stores/directEditOfferStore'
import { useEditorStore } from '@/stores/editorStore'
import { runDirectEditCascade } from '@/lib/annotations/directEditCascade'

const SNIPPET_MAX = 40

/**
 * Quiet, dismissible offer chip for the direct-edit cascade trigger (Flow v1
 * P4). No popup, no focus steal — a small fixed chip that OFFERS a dependency
 * check on a settled human edit. The LLM cascade runs only after the user
 * clicks Check (HITL + data-egress rules live in directEditTrigger/-Cascade).
 */
export function DirectEditCascadeChip() {
  const offer = useDirectEditOfferStore((s) => s.offer)
  const running = useDirectEditOfferStore((s) => s.running)

  const handleCheck = useCallback(async () => {
    const store = useDirectEditOfferStore.getState()
    const currentOffer = store.offer
    const view = useEditorStore.getState().view
    if (!currentOffer || !view || store.running) return
    store.setRunning(true)
    try {
      await runDirectEditCascade(view, currentOffer)
    } catch {
      // Best-effort: a failed cascade must never strand the chip.
    } finally {
      const s = useDirectEditOfferStore.getState()
      s.clearOffer()
      s.setRunning(false)
    }
  }, [])

  const handleDismiss = useCallback(() => {
    useDirectEditOfferStore.getState().clearOffer()
  }, [])

  if (!offer) return null

  const snippet =
    offer.blockText.length > SNIPPET_MAX
      ? `${offer.blockText.slice(0, SNIPPET_MAX - 1)}…`
      : offer.blockText
  const noun = offer.dependentCount === 1 ? 'dependent section' : 'dependent sections'

  return (
    <div
      role="status"
      aria-label={`You changed a section — offer to check ${offer.dependentCount} ${noun}`}
      className="fixed bottom-6 right-6 z-40 flex max-w-md items-center gap-2 rounded-full border border-stone-200 bg-white/95 px-4 py-2 text-sm text-stone-700 shadow-md backdrop-blur"
    >
      {running ? (
        <span className="italic text-stone-500">Checking dependent sections…</span>
      ) : (
        <>
          <span className="truncate">
            You changed &ldquo;{snippet}&rdquo; — check {offer.dependentCount} {noun}?
          </span>
          <button
            type="button"
            onClick={handleCheck}
            aria-label={`Check ${offer.dependentCount} ${noun}`}
            className="shrink-0 rounded-full bg-stone-800 px-3 py-1 text-xs font-medium text-white hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-500"
          >
            Check
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss this suggestion"
            className="shrink-0 rounded-full px-2 py-1 text-xs text-stone-500 hover:bg-stone-100 hover:text-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-400"
          >
            Dismiss
          </button>
        </>
      )}
    </div>
  )
}
