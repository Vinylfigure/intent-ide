import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { schema } from '@/lib/prosemirror/schema'
import { useSessionStore } from '@/stores/sessionStore'
import { useSettingsStore } from '@/stores/settingsStore'
import type { Annotation } from '@/lib/annotations/types'
import { resolveAnnotation, continueThread, streamResolveAnnotation } from '../resolver'

/**
 * Regression coverage for #68: maybeCompactContext() mutates the session
 * store in place, but a `sessionContext` local captured BEFORE the await
 * still points at the pre-compaction object — so even when compaction runs
 * successfully, the call that triggered it sent the stale, uncompacted
 * history anyway. continueThread never called maybeCompactContext() at all.
 *
 * A naive "compaction ran successfully" assertion would miss both bugs (the
 * store does end up compacted — just too late for the in-flight call, and
 * continueThread simply never checks). These tests assert on what the
 * *same, triggering* /api/resolve call actually sent.
 */

const COMPACTED_SUMMARY = 'Reviewer has focused on budget figures across three sections.'
const STALE_MARKER = 'STALE_UNCOMPACTED_MARKER'

// Comfortably above COMPACTION_THRESHOLD_TOKENS (64_000 tokens * 4 chars/token).
function bigHistory(): string {
  return `${STALE_MARKER}\n` + 'x'.repeat(300_000)
}

function doc() {
  return schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text('The total budget is $50,000 for the pilot program.')]),
  ])
}

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'ann-1',
    documentId: 'doc-A',
    locationGroupKey: 'loc-1',
    type: 'ask',
    status: 'resolving',
    transcript: 'what does this mean',
    anchor: { from: 1, to: 10, scope: 'sentence', text: 'The total' },
    resolution: null,
    conversation: [],
    parentId: null,
    childIds: [],
    createdAt: Date.now(),
    resolvedAt: null,
    verbosity: 'normal',
    ...overrides,
  }
}

function jsonResponse(data: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: async () => data }
}

/** SSE-shaped response for the `stream: true` branch streamResolveAnnotation actually parses. */
function sseResponse(text: string) {
  const encoder = new TextEncoder()
  const body = `data: ${JSON.stringify({ responseId: 'test-resp-1' })}\n\ndata: ${JSON.stringify({ text })}\n\n`
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(body))
        controller.close()
      },
    }),
    json: async () => ({}),
  }
}

/**
 * Records every /api/resolve call's system-message content, keyed by whether
 * it's the compaction call. Handles BOTH response shapes streamResolveAnnotation
 * and resolveAnnotation/continueThread actually use — a plain json() stub alone
 * would never exercise streamResolveAnnotation's SSE-reader branch (it throws
 * "No response body for stream" without a real ReadableStream body).
 */
function makeFetchStub() {
  const resolveSystemMessages: string[] = []
  let compactionCalls = 0

  const stub = vi.fn(async (input: unknown, init?: { body?: string }) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input)
    const body = init?.body ? JSON.parse(init.body) : null

    if (url.includes('/api/audit')) {
      // The real route returns { id }, not { auditId } — logAuditEvent reads
      // data.id, so the wrong key here would silently resolve every write to
      // null (see the identical fix in pipeline.capture.test.ts).
      return jsonResponse({ id: 'audit-test-1' })
    }
    if (url.includes('/api/resolve')) {
      const messages = body?.messages ?? []
      const isCompactionCall =
        messages.length === 1 && String(messages[0]?.content ?? '').includes('Compress the following review session')

      if (isCompactionCall) {
        compactionCalls++
        return jsonResponse({ content: COMPACTED_SUMMARY })
      }

      // The real resolution/continuation call — system message is messages[0].
      resolveSystemMessages.push(String(messages[0]?.content ?? ''))
      if (body?.stream) {
        return sseResponse('Agent reply.')
      }
      return jsonResponse({ content: 'Agent reply.', responseId: 'test-resp-1', logprobs: null })
    }
    return jsonResponse({})
  })

  return { stub, resolveSystemMessages, getCompactionCalls: () => compactionCalls }
}

beforeEach(() => {
  useSessionStore.getState().reset()
  useSettingsStore.getState().setLLMConfig({ provider: 'claude', model: 'claude-sonnet-4-6', apiKey: 'test-key' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveAnnotation re-reads session context after compaction', () => {
  it('the SAME call that triggers compaction sends the compacted history, not the stale pre-compaction one', async () => {
    useSessionStore.getState().updateContext({ annotationHistory: bigHistory() })

    const { stub, resolveSystemMessages, getCompactionCalls } = makeFetchStub()
    vi.stubGlobal('fetch', stub)

    const state = EditorState.create({ schema, doc: doc() })
    const annotation = makeAnnotation()

    await resolveAnnotation(annotation, state)

    expect(getCompactionCalls()).toBe(1)
    expect(resolveSystemMessages).toHaveLength(1)
    expect(resolveSystemMessages[0]).toContain(COMPACTED_SUMMARY)
    expect(resolveSystemMessages[0]).not.toContain(STALE_MARKER)

    // The store itself is compacted too (that part already worked pre-fix).
    expect(useSessionStore.getState().context.annotationHistory).toContain(COMPACTED_SUMMARY)
  })

  it('below the compaction threshold, no compaction call fires and history passes through unchanged', async () => {
    useSessionStore.getState().updateContext({ annotationHistory: 'short prior context' })

    const { stub, resolveSystemMessages, getCompactionCalls } = makeFetchStub()
    vi.stubGlobal('fetch', stub)

    const state = EditorState.create({ schema, doc: doc() })
    await resolveAnnotation(makeAnnotation(), state)

    expect(getCompactionCalls()).toBe(0)
    expect(resolveSystemMessages).toHaveLength(1)
    expect(resolveSystemMessages[0]).toContain('short prior context')
  })
})

describe('streamResolveAnnotation re-reads session context after compaction (the actually-reachable production path)', () => {
  // resolveAnnotation above has no production callers (AnnotationCard.tsx and
  // voice/pipeline.ts both call streamResolveAnnotation) — this suite is the
  // one that must catch the bug on the path the shipped UI actually uses.
  it('the SAME streamed call that triggers compaction sends the compacted history, not the stale pre-compaction one', async () => {
    useSessionStore.getState().updateContext({ annotationHistory: bigHistory() })

    const { stub, resolveSystemMessages, getCompactionCalls } = makeFetchStub()
    vi.stubGlobal('fetch', stub)

    const state = EditorState.create({ schema, doc: doc() })
    const annotation = makeAnnotation()
    const chunks: string[] = []

    const resolution = await streamResolveAnnotation(annotation, state, (c) => chunks.push(c))

    expect(getCompactionCalls()).toBe(1)
    expect(resolveSystemMessages).toHaveLength(1)
    expect(resolveSystemMessages[0]).toContain(COMPACTED_SUMMARY)
    expect(resolveSystemMessages[0]).not.toContain(STALE_MARKER)

    // The SSE plumbing itself worked (sanity check the stub is really exercised).
    expect(resolution.content).toBe('Agent reply.')
    expect(chunks.length).toBeGreaterThan(0)

    expect(useSessionStore.getState().context.annotationHistory).toContain(COMPACTED_SUMMARY)
  })
})

describe('continueThread compacts session context before sending it', () => {
  it('a large annotationHistory triggers compaction, and the follow-up call sends the compacted version', async () => {
    useSessionStore.getState().updateContext({ annotationHistory: bigHistory() })

    const { stub, resolveSystemMessages, getCompactionCalls } = makeFetchStub()
    vi.stubGlobal('fetch', stub)

    const state = EditorState.create({ schema, doc: doc() })
    const annotation = makeAnnotation({ type: 'ask', status: 'resolved' })

    await continueThread(annotation, 'and what about the second half?', state)

    // Before the fix, continueThread never called maybeCompactContext() at
    // all — this assertion is the one a naive "it returns a message" test
    // would never catch.
    expect(getCompactionCalls()).toBe(1)
    expect(resolveSystemMessages).toHaveLength(1)
    expect(resolveSystemMessages[0]).toContain(COMPACTED_SUMMARY)
    expect(resolveSystemMessages[0]).not.toContain(STALE_MARKER)
  })
})
