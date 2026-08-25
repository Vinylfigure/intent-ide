// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ResolutionActions } from '@/components/Annotations/ResolutionActions'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useToastStore } from '@/stores/toastStore'
import type { Annotation, ConversationMessage } from '@/lib/annotations/types'

// continueThread is the only call this test needs to control the timing of.
// `resolution.actions` is scoped to just the "Go deeper" (handler: 'explore')
// button so no other handler (several of which reach fetch-touching code
// like createCommit) is reachable from this render tree, and `view` is never
// set on editorStore so `sendFollowUp`'s `!currentView` guard would bail if
// this test accidentally exercised a view-dependent path.
vi.mock('@/lib/ai/resolver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/resolver')>()
  return { ...actual, continueThread: vi.fn() }
})

import { continueThread } from '@/lib/ai/resolver'
import { useEditorStore } from '@/stores/editorStore'
import { EditorState } from 'prosemirror-state'
import { schema } from '@/lib/prosemirror/schema'

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
      actions: [{ label: 'Go deeper', kind: 'deepen', handler: 'explore' }],
    },
    conversation: [
      { id: 'm1', role: 'user', content: 'What does this mean?', suggestedEdit: null, timestamp: 1 },
      { id: 'm2', role: 'agent', content: 'An explanation.', suggestedEdit: null, timestamp: 2 },
    ],
    parentId: null,
    childIds: [],
    createdAt: 0,
    resolvedAt: 1,
    verbosity: 'normal',
  }
}

function makeEditorState(): EditorState {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', { blockId: 'b1' }, [schema.text('Some text here.')]),
  ])
  return EditorState.create({ schema, doc })
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  useAnnotationStore.setState({ annotations: [] })
  useToastStore.setState({ toasts: [] })
  useEditorStore.setState({ view: null })
})

// Regression for #100: a "Simplify thread" collapse landing on the same
// annotation while a `continueThread` follow-up is in flight previously got
// silently appended onto the fresh one-message summary, with no indication
// to the user that the reply was generated against context that had already
// been discarded underneath it.
describe('continueThread follow-up vs. a concurrent conversation collapse (#100)', () => {
  it('discards the stale-context reply and toasts instead of appending it', async () => {
    const annotation = makeAnnotation()
    useAnnotationStore.setState({ annotations: [annotation] })
    // sendFollowUp's early `if (!currentView) return` guard requires a view.
    useEditorStore.setState({ view: { state: makeEditorState() } as never })

    let resolveRequest: (v: ConversationMessage) => void
    const pending = new Promise<ConversationMessage>((resolve) => {
      resolveRequest = resolve
    })
    vi.mocked(continueThread).mockReturnValue(pending)

    const { getByRole } = render(<ResolutionActions annotation={annotation} />)
    fireEvent.click(getByRole('button', { name: /go deeper/i }))

    // continueThread has been called (with the post-user-message conversation);
    // now simulate "Simplify thread" collapsing the conversation before the
    // follow-up resolves.
    await waitFor(() => expect(continueThread).toHaveBeenCalledTimes(1))
    useAnnotationStore.getState().update('ann-1', {
      conversation: [
        { id: 'summary-1', role: 'agent', content: 'A concise summary.', suggestedEdit: null, timestamp: 99 },
      ],
    })

    resolveRequest!({
      id: 'agent-reply-1',
      role: 'agent',
      content: 'Stale-context reply.',
      suggestedEdit: null,
      timestamp: 100,
    })
    await pending
    await waitFor(() =>
      expect(useAnnotationStore.getState().getById('ann-1')?.status).toBe('resolved'),
    )

    const live = useAnnotationStore.getState().getById('ann-1')
    expect(live?.conversation).toHaveLength(1)
    expect(live?.conversation.map((m) => m.id)).toEqual(['summary-1'])
    expect(live?.conversation.some((m) => m.id === 'agent-reply-1')).toBe(false)

    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].type).toBe('error')
    expect(toasts[0].message).toMatch(/changed while replying/i)
  })

  it('appends the reply normally when nothing else touched the conversation while in flight', async () => {
    const annotation = makeAnnotation()
    useAnnotationStore.setState({ annotations: [annotation] })
    useEditorStore.setState({ view: { state: makeEditorState() } as never })

    vi.mocked(continueThread).mockResolvedValue({
      id: 'agent-reply-1',
      role: 'agent',
      content: 'A real reply.',
      suggestedEdit: null,
      timestamp: 100,
    })

    const { getByRole } = render(<ResolutionActions annotation={annotation} />)
    fireEvent.click(getByRole('button', { name: /go deeper/i }))

    await waitFor(() =>
      expect(useAnnotationStore.getState().getById('ann-1')?.status).toBe('resolved'),
    )

    const live = useAnnotationStore.getState().getById('ann-1')
    expect(live?.conversation.some((m) => m.id === 'agent-reply-1')).toBe(true)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  // A prior round's adversarial review (troublemaker) found the first version
  // of this fix used plain conversation-array reference equality, which
  // false-positives on any concurrent write that reallocates the array
  // without actually discarding this request's context — the two cases
  // below. Fixed by checking message-id overlap instead of reference
  // identity (see the comment at the snapshot site in ResolutionActions.tsx).
  it('does not discard the reply when an unrelated updateMessage patch fires mid-flight (e.g. the fire-and-forget audit-outcome sync)', async () => {
    const annotation = makeAnnotation()
    useAnnotationStore.setState({ annotations: [annotation] })
    useEditorStore.setState({ view: { state: makeEditorState() } as never })

    let resolveRequest: (v: ConversationMessage) => void
    const pending = new Promise<ConversationMessage>((resolve) => {
      resolveRequest = resolve
    })
    vi.mocked(continueThread).mockReturnValue(pending)

    const { getByRole } = render(<ResolutionActions annotation={annotation} />)
    fireEvent.click(getByRole('button', { name: /go deeper/i }))

    await waitFor(() => expect(continueThread).toHaveBeenCalledTimes(1))

    // annotationStore's updateMessage always re-maps the conversation array
    // (a new reference), even when it only patches an existing message's
    // metadata — e.g. resolver.ts's syncMessageAuditOutcome, fired from a
    // logResolutionAudit(...).then() that settles independently of
    // continueThread's own return. This must not look like a collapse: the
    // message it targets (m2) is still present, unchanged in identity.
    useAnnotationStore.getState().updateMessage('ann-1', 'm2', { auditId: 'audit-x' })

    resolveRequest!({
      id: 'agent-reply-1',
      role: 'agent',
      content: 'A real reply.',
      suggestedEdit: null,
      timestamp: 100,
    })
    await pending
    await waitFor(() =>
      expect(useAnnotationStore.getState().getById('ann-1')?.status).toBe('resolved'),
    )

    const live = useAnnotationStore.getState().getById('ann-1')
    expect(live?.conversation.some((m) => m.id === 'agent-reply-1')).toBe(true)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('does not discard the reply when a second legitimate follow-up appends its own message mid-flight', async () => {
    const annotation = makeAnnotation()
    useAnnotationStore.setState({ annotations: [annotation] })
    useEditorStore.setState({ view: { state: makeEditorState() } as never })

    let resolveRequest: (v: ConversationMessage) => void
    const pending = new Promise<ConversationMessage>((resolve) => {
      resolveRequest = resolve
    })
    vi.mocked(continueThread).mockReturnValue(pending)

    const { getByRole } = render(<ResolutionActions annotation={annotation} />)
    fireEvent.click(getByRole('button', { name: /go deeper/i }))

    await waitFor(() => expect(continueThread).toHaveBeenCalledTimes(1))

    // A second, legitimate follow-up's synchronous user-message append
    // landing on the same annotation while the first request is still in
    // flight (no in-flight guard exists on these buttons today) only ADDS a
    // message — it doesn't remove any of the ones this request was
    // generated from, so it must not be treated as a collapse either.
    useAnnotationStore.getState().addMessage('ann-1', {
      id: 'user-msg-2',
      role: 'user',
      content: 'A second follow-up question',
      suggestedEdit: null,
      timestamp: 50,
    })

    resolveRequest!({
      id: 'agent-reply-1',
      role: 'agent',
      content: 'A real reply.',
      suggestedEdit: null,
      timestamp: 100,
    })
    await pending
    await waitFor(() =>
      expect(useAnnotationStore.getState().getById('ann-1')?.status).toBe('resolved'),
    )

    const live = useAnnotationStore.getState().getById('ann-1')
    expect(live?.conversation.some((m) => m.id === 'agent-reply-1')).toBe(true)
    expect(live?.conversation.some((m) => m.id === 'user-msg-2')).toBe(true)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  // A second round of adversarial review found that a late-settling follow-up
  // unconditionally wrote status: 'resolved' once it resolved — including
  // when a terminal action (apply/dismiss) had already completed on this
  // same annotation while the follow-up was still in flight, silently
  // reverting an 'applied'/'dismissed' status back to 'resolved' (lifecycle.ts
  // declares both terminal — no legal outgoing transition — but nothing
  // enforced that here). Fixed by only writing 'resolved' while the
  // annotation's status is still 'resolving'.
  it('does not resurrect a terminal status set by a concurrent action (e.g. Apply) while a follow-up is in flight', async () => {
    const annotation = makeAnnotation()
    useAnnotationStore.setState({ annotations: [annotation] })
    useEditorStore.setState({ view: { state: makeEditorState() } as never })

    let resolveRequest: (v: ConversationMessage) => void
    const pending = new Promise<ConversationMessage>((resolve) => {
      resolveRequest = resolve
    })
    vi.mocked(continueThread).mockReturnValue(pending)

    const { getByRole } = render(<ResolutionActions annotation={annotation} />)
    fireEvent.click(getByRole('button', { name: /go deeper/i }))

    await waitFor(() => expect(continueThread).toHaveBeenCalledTimes(1))
    expect(useAnnotationStore.getState().getById('ann-1')?.status).toBe('resolving')

    // Simulate a concurrent Apply completing on this same annotation while
    // the follow-up is still in flight — Apply doesn't touch `conversation`,
    // so this must not be misread as a collapse, but it DOES reach a
    // terminal status that the follow-up must not overwrite.
    useAnnotationStore.getState().update('ann-1', { status: 'applied' })

    resolveRequest!({
      id: 'agent-reply-1',
      role: 'agent',
      content: 'A real reply.',
      suggestedEdit: null,
      timestamp: 100,
    })
    await pending
    // Give the (now unguarded) status write a chance to land if the guard
    // were absent — there's no separate observable event to await here, so
    // wait on the message actually landing first (proof the promise chain
    // ran to completion) before asserting status.
    await waitFor(() =>
      expect(useAnnotationStore.getState().getById('ann-1')?.conversation.some((m) => m.id === 'agent-reply-1')).toBe(true),
    )

    expect(useAnnotationStore.getState().getById('ann-1')?.status).toBe('applied')
  })

  // A third round of adversarial review found the round-2 fix only guarded
  // the EXIT status write (finishFollowUp) — the ENTRY write two lines above
  // it (`status: 'resolving'`) was still unconditional. Deepen-kind actions
  // (Go deeper, Tweak it, ...) stay clickable after Apply (only apply-kind
  // buttons are disabled once applied), so clicking one after Apply
  // deterministically clobbered 'applied' back to 'resolving' — no race
  // required at all, unlike round 2's scenario. Fixed by checking the live
  // status directly (applied/dismissed) before the entry write and bailing
  // out before ever touching the conversation or calling continueThread —
  // see the next test for why this is a direct check, not canTransition.
  it('refuses to start a follow-up on an annotation that already reached a terminal status, with no race involved', async () => {
    const annotation = makeAnnotation()
    annotation.status = 'applied'
    useAnnotationStore.setState({ annotations: [annotation] })
    useEditorStore.setState({ view: { state: makeEditorState() } as never })

    const { getByRole } = render(<ResolutionActions annotation={annotation} />)
    fireEvent.click(getByRole('button', { name: /go deeper/i }))

    expect(continueThread).not.toHaveBeenCalled()
    expect(useAnnotationStore.getState().getById('ann-1')?.status).toBe('applied')
    expect(useAnnotationStore.getState().getById('ann-1')?.conversation).toHaveLength(2)
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toMatch(/already been applied or dismissed/i)
  })

  // Self-caught while writing the entry guard above: an earlier version
  // checked `!canTransition(status, 'resolving')`, but lifecycle.ts's
  // TRANSITIONS models 'resolving' as transitioning only to 'resolved' — not
  // to itself — so that check would ALSO have rejected a second legitimate
  // follow-up landing while the first is still 'resolving', which rounds 1-2
  // deliberately preserved as valid. The guard must trigger only on the two
  // genuinely terminal statuses, not on "already in flight."
  it('allows a second follow-up to start while the first is still in flight (does not misread "resolving" as terminal)', async () => {
    const annotation = makeAnnotation()
    useAnnotationStore.setState({ annotations: [annotation] })
    useEditorStore.setState({ view: { state: makeEditorState() } as never })

    const deferred: Array<(v: ConversationMessage) => void> = []
    vi.mocked(continueThread).mockImplementation(
      () => new Promise((resolve) => { deferred.push(resolve) }),
    )

    const { getByRole } = render(<ResolutionActions annotation={annotation} />)
    const button = getByRole('button', { name: /go deeper/i })

    fireEvent.click(button)
    await waitFor(() => expect(continueThread).toHaveBeenCalledTimes(1))
    expect(useAnnotationStore.getState().getById('ann-1')?.status).toBe('resolving')

    fireEvent.click(button)
    await waitFor(() => expect(continueThread).toHaveBeenCalledTimes(2))

    deferred[0]({ id: 'reply-a', role: 'agent', content: 'Reply A', suggestedEdit: null, timestamp: 100 })
    deferred[1]({ id: 'reply-b', role: 'agent', content: 'Reply B', suggestedEdit: null, timestamp: 101 })
    await waitFor(() =>
      expect(useAnnotationStore.getState().getById('ann-1')?.status).toBe('resolved'),
    )

    const live = useAnnotationStore.getState().getById('ann-1')
    expect(live?.conversation.some((m) => m.id === 'reply-a')).toBe(true)
    expect(live?.conversation.some((m) => m.id === 'reply-b')).toBe(true)
    expect(
      useToastStore.getState().toasts.some((t) => /already been applied or dismissed/i.test(t.message)),
    ).toBe(false)
  })
})
