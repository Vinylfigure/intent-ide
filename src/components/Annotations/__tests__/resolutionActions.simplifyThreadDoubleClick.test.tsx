// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { ResolutionActions } from '@/components/Annotations/ResolutionActions'
import { useAnnotationStore } from '@/stores/annotationStore'
import type { Annotation } from '@/lib/annotations/types'

// simplifyThread is the only call this test needs to control the timing of —
// everything else ResolutionActions imports is left real (module import
// alone doesn't touch network/env, and no other handler is exercised here).
// Safety of that depends on the fixture below: `resolution.actions: []`
// keeps every other action button (apply-edit, add-to-doc, etc. — several
// of which reach `fetch`-touching code like `createCommit`) from rendering
// at all, and a 3-message `conversation` keeps `showDiffModal` at its
// initial `false` for the whole test, so `SemanticCommitModal` never
// mounts. Widening this fixture (e.g. adding a real `resolution.actions`
// entry) can pull one of those real, unmocked paths into the render tree.
vi.mock('@/lib/ai/resolver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/resolver')>()
  return { ...actual, simplifyThread: vi.fn() }
})

import { simplifyThread } from '@/lib/ai/resolver'

function makeAnnotation(): Annotation {
  return {
    id: 'ann-1',
    documentId: 'doc-1',
    locationGroupKey: 'doc-1:0:1',
    type: 'ask',
    status: 'resolved',
    transcript: 'What does this mean?',
    anchor: { from: 0, to: 1, scope: 'sentence', text: 'What does this mean?' },
    resolution: {
      type: 'ask',
      content: 'An explanation.',
      suggestedEdit: null,
      actions: [],
    },
    conversation: [
      { id: 'm1', role: 'user', content: 'First message', suggestedEdit: null, timestamp: 1 },
      { id: 'm2', role: 'agent', content: 'First reply', suggestedEdit: null, timestamp: 2 },
      { id: 'm3', role: 'user', content: 'Second message', suggestedEdit: null, timestamp: 3 },
    ],
    parentId: null,
    childIds: [],
    createdAt: 0,
    resolvedAt: 1,
    verbosity: 'normal',
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  useAnnotationStore.setState({ annotations: [] })
})

// Regression for #93: the #88 fix added an `isSimplifying` React-state guard
// to the "Simplify thread" button, but no test exercised the real button —
// #88's and #92's coverage both re-implement the surrounding branch logic in
// isolation (resolutionActions.simplifyThreadGate.pure.test.ts) rather than
// clicking the actual button twice. This test mounts the real component and
// asserts the observable outcome (no duplicate `simplifyThread` call across
// two rapid clicks), not one specific mechanism in isolation: two clicks
// fired back-to-back via `fireEvent` are each individually `act()`-flushed,
// so by the second click the `disabled={isSimplifying}` attribute has
// already committed and jsdom (like a real browser) never dispatches a
// click to a disabled button — meaning this test is only guaranteed to
// catch a regression that drops *both* the `if (isSimplifying) return`
// early-return and the `disabled` attribute together, not one alone.
// Verified directly: reverting the early-return only, or the `disabled`
// attribute only, each still leaves this test green; reverting both at once
// makes it fail (`called 1 times, but got 2 times`) — which is still
// strictly more coverage of the real component than the pure
// re-implementations above provide today (they cover neither).
describe('Simplify thread double-click in-flight guard (#93)', () => {
  it('fires simplifyThread only once for two rapid clicks while the first request is in flight', async () => {
    const annotation = makeAnnotation()
    useAnnotationStore.setState({ annotations: [annotation] })

    let resolveRequest: (v: { content: string; requestFailed?: boolean }) => void
    const pending = new Promise<{ content: string; requestFailed?: boolean }>((resolve) => {
      resolveRequest = resolve
    })
    vi.mocked(simplifyThread).mockReturnValue(pending)

    const { getByRole, findByRole } = render(<ResolutionActions annotation={annotation} />)
    const button = getByRole('button', { name: /simplify thread/i })

    fireEvent.click(button)
    fireEvent.click(button)

    expect(simplifyThread).toHaveBeenCalledTimes(1)
    const disabledButton = await findByRole('button', { name: /simplifying/i })
    expect((disabledButton as HTMLButtonElement).disabled).toBe(true)

    resolveRequest!({ content: 'A concise summary.' })
    await pending

    expect(simplifyThread).toHaveBeenCalledTimes(1)
  })

  it('re-enables the button and allows a fresh request once the in-flight one settles', async () => {
    const annotation = makeAnnotation()
    useAnnotationStore.setState({ annotations: [annotation] })

    let resolveRequest: (v: { content: string; requestFailed?: boolean }) => void
    const firstPending = new Promise<{ content: string; requestFailed?: boolean }>((resolve) => {
      resolveRequest = resolve
    })
    vi.mocked(simplifyThread).mockReturnValueOnce(firstPending)

    const { getByRole, findByRole } = render(<ResolutionActions annotation={annotation} />)
    const button = getByRole('button', { name: /simplify thread/i })

    fireEvent.click(button)
    resolveRequest!({ content: 'A concise summary.' })
    await firstPending

    // Re-enabling happens in the same handler that applies the summary, so
    // wait for the button to actually flip back before clicking again —
    // asserting immediately after a bare `await` races React's own
    // (unbatched, outside `act()`) state flush.
    const reenabledButton = await findByRole('button', { name: /^simplify thread$/i })

    vi.mocked(simplifyThread).mockResolvedValueOnce({ content: 'Another summary.' })
    fireEvent.click(reenabledButton)

    expect(simplifyThread).toHaveBeenCalledTimes(2)
  })
})
