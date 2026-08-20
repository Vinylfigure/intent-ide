import { EditorState } from 'prosemirror-state'
import { inferScope } from '@/lib/prosemirror/helpers'
import { findAppliedEditFinalPosition, type AppliedEdit } from '@/lib/prosemirror/applyProposedEdits'
import type { TextAnchor, Scope, ProposedEdit } from './types'

export function createAnchor(
  state: EditorState,
  from: number,
  to: number,
): TextAnchor {
  const scope = inferScope(state, from, to)
  const text = state.doc.textBetween(from, to)

  return { from, to, scope, text }
}

/**
 * Re-anchors a TextAnchor to where an applied edit actually landed.
 *
 * `parseSuggestedEdit` always derives a fresh SUGGESTED EDIT's from/to from
 * `annotation.anchor`, and every apply path validates that suggestion's
 * targetText against `annotation.anchor.text` (applyProposedEdits.ts's
 * fingerprint check) before dispatching. An annotation whose anchor never
 * moves past its FIRST successful apply would have every later re-apply on
 * the same thread ("Tweak it", a further per-message edit) validate against
 * stale pre-apply text and fail-closed. `scope` is preserved — an apply never
 * changes what range-expansion mode the annotation was created with.
 */
export function refreshAnchorAfterApply(
  anchor: TextAnchor,
  applied: { from: number; to: number; newText: string },
): TextAnchor {
  return { ...anchor, from: applied.from, to: applied.from + applied.newText.length, text: applied.newText }
}

/**
 * Refreshes `anchor` after a multi-region (`applyProposedEdits`) batch apply,
 * to the PRIMARY edit's true post-transaction position — mirrors the
 * single-edit `refreshAnchorAfterApply` call sites, extracted into one pure,
 * directly-testable function (no view/doc dependency — see
 * `findAppliedEditFinalPosition`'s doc comment for why arithmetic over the
 * batch's own deltas, not a doc fingerprint search, derives that position)
 * so the actual apply-time wiring in ResolutionActions.tsx has real
 * regression coverage, not just the underlying position math (#44 review).
 *
 * Returns undefined (anchor left untouched) when: no edit in `proposed` is
 * tagged `relation: 'primary'`; the primary wasn't in `appliedEdits` (it was
 * rejected, or excluded as a no-op — `targetText === newText` — by
 * `applyProposedEdits`); or the primary was a pure deletion (`newText===''`
 * — no text for a future re-apply's fingerprint check to validate against,
 * so refreshing here would let that check trivially pass on stale content,
 * same reasoning as why insertions can't be fingerprint-validated).
 */
export function refreshedAnchorForMultiRegionApply(
  anchor: TextAnchor,
  proposed: ProposedEdit[],
  appliedEdits: AppliedEdit[],
): TextAnchor | undefined {
  const appliedPrimary = appliedEdits.find(
    (ap) => proposed.find((e) => e.id === ap.id)?.relation === 'primary',
  )
  if (!appliedPrimary || !appliedPrimary.newText) return undefined
  const { from, to } = findAppliedEditFinalPosition(appliedPrimary, appliedEdits)
  return refreshAnchorAfterApply(anchor, { from, to, newText: appliedPrimary.newText })
}

// Expand a selection to its full scope
export function expandToScope(
  state: EditorState,
  from: number,
  to: number,
  scope: Scope,
): { from: number; to: number } {
  const $from = state.doc.resolve(from)

  switch (scope) {
    case 'phrase':
      return { from, to }

    case 'sentence': {
      // Expand to sentence boundaries
      const blockStart = $from.start($from.depth)
      const blockEnd = $from.end($from.depth)
      const blockText = state.doc.textBetween(blockStart, blockEnd)
      const relFrom = from - blockStart
      const relTo = to - blockStart

      // Find sentence start (look backward for . ! ? or start of block)
      let sentStart = blockText.lastIndexOf('.', relFrom - 1)
      sentStart = Math.max(sentStart, blockText.lastIndexOf('!', relFrom - 1))
      sentStart = Math.max(sentStart, blockText.lastIndexOf('?', relFrom - 1))
      sentStart = sentStart === -1 ? 0 : sentStart + 1

      // Find sentence end
      let sentEnd = blockText.indexOf('.', relTo)
      if (sentEnd === -1) sentEnd = blockText.indexOf('!', relTo)
      if (sentEnd === -1) sentEnd = blockText.indexOf('?', relTo)
      sentEnd = sentEnd === -1 ? blockText.length : sentEnd + 1

      return {
        from: blockStart + sentStart,
        to: blockStart + sentEnd,
      }
    }

    case 'paragraph': {
      return {
        from: $from.start($from.depth),
        to: $from.end($from.depth),
      }
    }

    case 'section': {
      // Expand to heading-to-heading
      let sectionStart = 0
      let sectionEnd = state.doc.content.size

      state.doc.nodesBetween(0, from, (node, pos) => {
        if (node.type.name === 'heading') {
          sectionStart = pos
        }
      })

      let foundNext = false
      state.doc.nodesBetween(to, state.doc.content.size, (node, pos) => {
        if (node.type.name === 'heading' && pos > to && !foundNext) {
          sectionEnd = pos
          foundNext = true
        }
      })

      return { from: sectionStart, to: sectionEnd }
    }
  }
}
