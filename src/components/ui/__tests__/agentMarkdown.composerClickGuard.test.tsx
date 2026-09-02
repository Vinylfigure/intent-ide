// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { AgentMarkdown } from '@/components/ui/AgentMarkdown'

// Answer text picked so inferScopeFromText (two sentences, >1 total) lands on
// 'paragraph' scope — deriveOffers then always returns a non-empty, stable
// set of quick actions (Summarize / Diagram this / Find conflicts) for it.
// The exact labels aren't asserted on below; only that quick-action buttons
// exist, per the "resilient to whichever offers get derived" instruction.
const ANSWER_TEXT = 'The system retries on failure. It also logs each attempt for debugging.'

// window.getSelection does no real selection work in jsdom — stub it with an
// object shaped like the (narrow) slice of `Selection` AgentMarkdown's
// handleMouseUp actually reads: isCollapsed, rangeCount, toString(), and
// getRangeAt() returning a range-shaped object with commonAncestorContainer
// and getBoundingClientRect(). No other Selection members are read, so none
// are stubbed.
function stubOpenSelection(text: string, anchorNode: Node) {
  return vi.spyOn(window, 'getSelection').mockReturnValue({
    isCollapsed: false,
    rangeCount: 1,
    toString: () => text,
    getRangeAt: () => ({
      commonAncestorContainer: anchorNode,
      getBoundingClientRect: () => ({
        left: 10, top: 10, right: 20, bottom: 20, width: 10, height: 10, x: 10, y: 10, toJSON() {},
      }),
    }),
  } as unknown as Selection)
}

// The collapsed selection a real browser reports the instant after a
// mousedown lands inside the already-open composer (whatever text selection
// existed a moment ago is gone) — this is what a genuine button click
// produces just before its own mouseup bubbles to the container.
function stubCollapsedSelection() {
  return vi.spyOn(window, 'getSelection').mockReturnValue({
    isCollapsed: true,
    rangeCount: 0,
    toString: () => '',
    getRangeAt: () => {
      throw new Error('collapsed selection — handleMouseUp must never call getRangeAt here')
    },
  } as unknown as Selection)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// Opens the drill composer the same way a real drag-selection would: render,
// stub an open selection anchored on a real node the container contains,
// then fire the mouseup that AgentMarkdown's onMouseUp handler reads to
// decide whether to open it.
function openComposer(onDrill: ReturnType<typeof vi.fn>) {
  const utils = render(
    <AgentMarkdown content={ANSWER_TEXT} interactive onDrill={onDrill} />,
  )
  const answerParagraph = utils.container.querySelector('p')
  if (!answerParagraph) throw new Error('expected Streamdown to render the answer as a <p>')
  stubOpenSelection(ANSWER_TEXT, answerParagraph)
  fireEvent.mouseUp(answerParagraph)
  return { ...utils, answerParagraph }
}

describe('AgentMarkdown composer click guard', () => {
  // The regression itself. Before the fix, a mouseup bubbling from inside
  // the composer (exactly what a button click produces) fell through to the
  // "selection is collapsed" branch and unmounted the composer out from
  // under its own button before the click could fire.
  it('keeps the composer mounted when a mouseup lands on an element inside it with a collapsed selection', async () => {
    const onDrill = vi.fn()
    const { getByPlaceholderText, getAllByRole } = openComposer(onDrill)

    // Composer is open — confirm it, then locate a real element inside it
    // to use as the mouseup target.
    expect(getByPlaceholderText(/add a note or follow-up/i)).toBeTruthy()
    const quickActionButtons = getAllByRole('button').filter((b) =>
      (b as HTMLButtonElement).title.includes('one click, no typing needed'),
    )
    expect(quickActionButtons.length).toBeGreaterThan(0)

    stubCollapsedSelection()
    fireEvent.mouseUp(quickActionButtons[0])

    // Without the composerRef.current?.contains(...) guard, this mouseup
    // would have called setComposer(null) and torn the composer down.
    expect(getByPlaceholderText(/add a note or follow-up/i)).toBeTruthy()
  })

  // The user-visible symptom of the bug, stated as a test: a quick-action
  // click inside the composer must actually reach onDrill.
  it('reaches onDrill with the selected text as the quote when a quick-action button is clicked', async () => {
    const onDrill = vi.fn()
    const { getAllByRole } = openComposer(onDrill)

    const quickActionButtons = getAllByRole('button').filter((b) =>
      (b as HTMLButtonElement).title.includes('one click, no typing needed'),
    )
    expect(quickActionButtons.length).toBeGreaterThan(0)

    fireEvent.click(quickActionButtons[0])

    await waitFor(() => expect(onDrill).toHaveBeenCalledTimes(1))
    expect(onDrill.mock.calls[0][0]).toMatchObject({ quote: ANSWER_TEXT })
  })

  // Guard did not break dismissal: a mouseup outside the composer (target is
  // the answer body itself, not a composer descendant) with a collapsed
  // selection must still close it.
  it('still closes the composer on a mouseup outside it with a collapsed selection', () => {
    const onDrill = vi.fn()
    const { getByPlaceholderText, queryByPlaceholderText, answerParagraph } = openComposer(onDrill)

    expect(getByPlaceholderText(/add a note or follow-up/i)).toBeTruthy()

    stubCollapsedSelection()
    fireEvent.mouseUp(answerParagraph)

    expect(queryByPlaceholderText(/add a note or follow-up/i)).toBeNull()
  })
})
