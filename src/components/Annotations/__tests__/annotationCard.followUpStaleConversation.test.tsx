// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { AnnotationCard } from '@/components/Annotations/AnnotationCard'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useToastStore } from '@/stores/toastStore'
import { useEditorStore } from '@/stores/editorStore'
import { useFlowStore } from '@/stores/flowStore'
import { schema } from '@/lib/prosemirror/schema'
import type { Annotation, ConversationMessage } from '@/lib/annotations/types'

// continueThread is the only call these tests need to control the timing of.
vi.mock('@/lib/ai/resolver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/resolver')>()
  return { ...actual, continueThread: vi.fn() }
})

import { continueThread } from '@/lib/ai/resolver'

// A provocation gives the card a second, always-clickable follow-up entry
// point ("Tell me more") distinct from FollowUpInput's free-text box —
// FollowUpInput disables itself while `status === 'resolving'`, so it can't
// by itself originate a second concurrent request; the provocation button
// can, and both are wired to the same `handleFollowUp`.
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
      provocation: 'This might not hold in every case.',
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

function mountView(): EditorView {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const doc = schema.node('doc', null, [
    schema.node('paragraph', { blockId: 'b1' }, [schema.text('Some text here.')]),
  ])
  const state = EditorState.create({ schema, doc })
  // EXACT EditorShell dispatchTransaction shape — see editorMount.smoke.test.ts.
  const view: EditorView = new EditorView(host, {
    state,
    dispatchTransaction(transaction) {
      view.updateState(view.state.apply(transaction))
    },
  })
  return view
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  useAnnotationStore.setState({ annotations: [] })
  useToastStore.setState({ toasts: [] })
  useFlowStore.setState({ heldAnswers: {} })
  const view = useEditorStore.getState().view as EditorView | null
  view?.destroy()
  useEditorStore.setState({ view: null })
})

function sendViaFollowUpInput(getByPlaceholderText: (t: RegExp | string) => HTMLElement, text: string) {
  const input = getByPlaceholderText(/follow up/i) as HTMLInputElement
  fireEvent.change(input, { target: { value: text } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

// Regression for #104: AnnotationCard.handleFollowUp — a second, unpatched
// call site sharing #100's exact vulnerability (a "Simplify thread" collapse
// or a concurrent terminal action landing while a follow-up is in flight).
describe('AnnotationCard.handleFollowUp vs. a concurrent conversation collapse / terminal status (#104)', () => {
  it('discards the stale-context reply and toasts instead of appending it', async () => {
    const annotation = makeAnnotation()
    useAnnotationStore.setState({ annotations: [annotation] })
    const view = mountView()
    useEditorStore.setState({ view })

    let resolveRequest: (v: ConversationMessage) => void
    const pending = new Promise<ConversationMessage>((resolve) => {
      resolveRequest = resolve
    })
    vi.mocked(continueThread).mockReturnValue(pending)

    const { getByPlaceholderText } = render(<AnnotationCard annotation={annotation} isActive={true} />)
    sendViaFollowUpInput(getByPlaceholderText, 'Tell me more about that')

    await waitFor(() => expect(continueThread).toHaveBeenCalledTimes(1))
    // Simulate "Simplify thread" collapsing the conversation before the
    // follow-up resolves.
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
    expect(live?.conversation.some((m) => m.id === 'agent-reply-1')).toBe(false)

    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].type).toBe('error')
    expect(toasts[0].message).toMatch(/changed while replying/i)
  })

  it('does not resurrect a terminal status set by a concurrent action (e.g. Apply) while a follow-up is in flight', async () => {
    const annotation = makeAnnotation()
    useAnnotationStore.setState({ annotations: [annotation] })
    const view = mountView()
    useEditorStore.setState({ view })

    let resolveRequest: (v: ConversationMessage) => void
    const pending = new Promise<ConversationMessage>((resolve) => {
      resolveRequest = resolve
    })
    vi.mocked(continueThread).mockReturnValue(pending)

    const { getByPlaceholderText } = render(<AnnotationCard annotation={annotation} isActive={true} />)
    sendViaFollowUpInput(getByPlaceholderText, 'Go deeper please')

    await waitFor(() => expect(continueThread).toHaveBeenCalledTimes(1))
    expect(useAnnotationStore.getState().getById('ann-1')?.status).toBe('resolving')

    // A concurrent Apply completes on this same annotation while the
    // follow-up is still in flight. Apply doesn't touch `conversation`, so
    // this must not be misread as a collapse — but it IS a terminal status
    // the follow-up must not overwrite.
    useAnnotationStore.getState().update('ann-1', { status: 'applied' })

    resolveRequest!({
      id: 'agent-reply-1',
      role: 'agent',
      content: 'A real reply.',
      suggestedEdit: null,
      timestamp: 100,
    })
    await pending
    await waitFor(() =>
      expect(
        useAnnotationStore.getState().getById('ann-1')?.conversation.some((m) => m.id === 'agent-reply-1'),
      ).toBe(true),
    )

    expect(useAnnotationStore.getState().getById('ann-1')?.status).toBe('applied')
  })

  it('refuses to start a follow-up on an annotation that already reached a terminal status, with no network call', async () => {
    const annotation = makeAnnotation()
    annotation.status = 'applied'
    useAnnotationStore.setState({ annotations: [annotation] })
    const view = mountView()
    useEditorStore.setState({ view })

    const { getByPlaceholderText } = render(<AnnotationCard annotation={annotation} isActive={true} />)
    sendViaFollowUpInput(getByPlaceholderText, 'One more thing')

    expect(continueThread).not.toHaveBeenCalled()
    expect(useAnnotationStore.getState().getById('ann-1')?.status).toBe('applied')
    expect(useAnnotationStore.getState().getById('ann-1')?.conversation).toHaveLength(2)
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toMatch(/already been applied or dismissed/i)
  })

  it('allows a second concurrent follow-up from a different entry point (the provocation "Tell me more" button) while the first is still in flight', async () => {
    const annotation = makeAnnotation()
    useAnnotationStore.setState({ annotations: [annotation] })
    const view = mountView()
    useEditorStore.setState({ view })

    const deferred: Array<(v: ConversationMessage) => void> = []
    vi.mocked(continueThread).mockImplementation(
      () => new Promise((resolve) => { deferred.push(resolve) }),
    )

    const { getByPlaceholderText, getByRole } = render(
      <AnnotationCard annotation={annotation} isActive={true} />,
    )

    sendViaFollowUpInput(getByPlaceholderText, 'First question')
    await waitFor(() => expect(continueThread).toHaveBeenCalledTimes(1))
    expect(useAnnotationStore.getState().getById('ann-1')?.status).toBe('resolving')

    // FollowUpInput disables itself once resolving, but the provocation's
    // "Tell me more" button carries no such guard — it reaches the same
    // handleFollowUp and must not be blocked or its reply discarded.
    fireEvent.click(getByRole('button', { name: /tell me more/i }))
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
