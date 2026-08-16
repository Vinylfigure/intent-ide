// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { schema } from '@/lib/prosemirror/schema'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useEditorStore } from '@/stores/editorStore'
import { useDocumentStore } from '@/stores/documentStore'
import { useToastStore } from '@/stores/toastStore'
import { useFlowStore } from '@/stores/flowStore'
import { useSessionStore } from '@/stores/sessionStore'
import {
  captureAnnotationFromText,
  captureAndResolveInBackground,
} from '../pipeline'

/**
 * Fire-and-forget capture pipeline tests (Flow v1 Track A).
 *
 * A real EditorView is mounted (same pattern as editorMount.smoke.test.ts)
 * and global fetch is stubbed with e2e-interceptor-shaped responses (see
 * tests/cascade-review.spec.ts): /api/resolve serves BOTH the streaming SSE
 * shape and the MADS non-stream shape, branched exactly like the Playwright
 * interceptors.
 */

// Controllable pass-through mock over the resolver so individual tests can
// force streamResolveAnnotation to throw (background-failure path).
const resolverControl = vi.hoisted(() => ({
  streamOverride: null as null | (() => Promise<never>),
}))

// jsdom HAS a window, so the mermaid guard runs real validation here — mock
// the mermaid module so no real (heavy) parser loads and parsing always fails.
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn(async () => {
      throw new Error('Parse error: bad node')
    }),
  },
}))

vi.mock('@/lib/ai/resolver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/resolver')>()
  return {
    ...actual,
    streamResolveAnnotation: (
      ...args: Parameters<typeof actual.streamResolveAnnotation>
    ) =>
      resolverControl.streamOverride
        ? resolverControl.streamOverride()
        : actual.streamResolveAnnotation(...args),
  }
})

// ---------------------------------------------------------------------------
// Fetch stub — both /api/resolve shapes (SSE stream + MADS transcripts)
// ---------------------------------------------------------------------------

const JUDGE_OUTPUT = [
  'VERDICT: APPROVE',
  '',
  'The proposed change is internally consistent.',
].join('\n')

const STREAMED_ANSWER = 'This passage means the budget is fixed.'

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => data,
  }
}

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

interface FetchStubOptions {
  /** Promise gating /api/classify responses (test releases it). */
  classifyGate?: Promise<void>
  /** Respond to /api/classify with this type; 'FAIL' → non-ok response. */
  classifyType?: string
  /** Promise gating /api/resolve responses. */
  resolveGate?: Promise<void>
  /** Content for streamed (SSE) resolutions. */
  streamText?: string
}

function makeFetchStub(options: FetchStubOptions = {}) {
  const calls: Array<{ url: string; body: any }> = []
  const stub = vi.fn(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input)
    let body: any = null
    try {
      body = init?.body ? JSON.parse(init.body) : null
    } catch {
      body = null
    }
    calls.push({ url, body })

    if (url.includes('localhost:8000')) {
      throw new Error('graphiti unavailable (stubbed)')
    }
    if (url.includes('/api/classify')) {
      if (options.classifyGate) await options.classifyGate
      if (options.classifyType === 'FAIL') {
        return { ok: false, status: 500, statusText: 'boom', json: async () => ({}) }
      }
      return jsonResponse({ type: options.classifyType ?? 'ask' })
    }
    if (url.includes('/api/resolve')) {
      if (options.resolveGate) await options.resolveGate
      const userContent = (body?.messages ?? [])
        .map((m: { content: string }) => m.content)
        .join('\n')
      // MADS branch shapes — mirrored from tests/cascade-review.spec.ts
      let content: string
      if (userContent.includes('Find every edge case')) {
        content = 'No material risks found.'
      } else if (userContent.includes('Find safe, accurate common ground')) {
        content = 'Both perspectives agree.'
      } else if (userContent.includes('Issue your verdict')) {
        content = JUDGE_OUTPUT
      } else {
        content = options.streamText ?? STREAMED_ANSWER
      }
      if (body?.stream) {
        return sseResponse(options.streamText ?? STREAMED_ANSWER)
      }
      return jsonResponse({ content, responseId: 'test-resp-1', logprobs: null })
    }
    if (url.includes('/api/structured')) {
      return jsonResponse({ toolCalls: [] })
    }
    if (url.includes('/api/audit')) {
      return jsonResponse({ auditId: 'audit-test-1' })
    }
    return jsonResponse({})
  })
  return { stub, calls }
}

// ---------------------------------------------------------------------------
// Editor + store setup
// ---------------------------------------------------------------------------

const PARA_1 = 'The total budget is $50,000 for the pilot program.'
const PARA_2 = 'Marketing may spend ten percent of the total budget quarterly.'

function mountEditor(): EditorView {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text(PARA_1)]),
    schema.node('paragraph', null, [schema.text(PARA_2)]),
  ])
  const state = EditorState.create({ schema, doc })
  const view: EditorView = new EditorView(host, {
    state,
    dispatchTransaction(transaction) {
      const newState = view.state.apply(transaction)
      view.updateState(newState)
    },
  })
  return view
}

async function waitFor(cond: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

function getAnnotation(id: string) {
  const ann = useAnnotationStore.getState().getById(id)
  if (!ann) throw new Error(`annotation ${id} missing`)
  return ann
}

let view: EditorView

beforeEach(() => {
  resolverControl.streamOverride = null
  useAnnotationStore.getState().clear()
  useToastStore.setState({ toasts: [] })
  useFlowStore.setState({ bufferAnswersEnabled: true, heldAnswers: {} })
  // Session history leaks prompt text between tests (fetch-call content
  // assertions branch on it) — start each test clean.
  useSessionStore.getState().reset()
  useDocumentStore.setState({ activeDocumentId: 'doc-test' })
  view = mountEditor()
  useEditorStore.getState().setView(view)
})

afterEach(() => {
  useEditorStore.getState().setView(null)
  view.destroy()
  vi.unstubAllGlobals()
})

// Anchor inside paragraph 1 (positions 1..10 are safely inside its text).
const FROM = 1
const TO = 10

describe('captureAnnotationFromText (synchronous capture)', () => {
  it('(a) returns an id synchronously and the annotation exists as pending before classify resolves', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const { stub } = makeFetchStub({ classifyGate: gate, classifyType: 'dig' })
    vi.stubGlobal('fetch', stub)

    const id = captureAndResolveInBackground('ask', 'what does this mean', FROM, TO)
    expect(id).toBeTruthy()

    // Synchronously visible, still pending — classify has not resolved yet.
    const ann = getAnnotation(id!)
    expect(ann.status).toBe('pending')
    expect(ann.type).toBe('ask')
    expect(ann.anchor.text).toBe(PARA_1.slice(FROM - 1, TO - 1))
    expect(useAnnotationStore.getState().activeAnnotationId).toBe(id)

    release()
    await waitFor(() => getAnnotation(id!).status === 'resolved')
  })

  it('returns null when there is no editor view', () => {
    useEditorStore.getState().setView(null)
    const { stub } = makeFetchStub()
    vi.stubGlobal('fetch', stub)
    expect(captureAnnotationFromText('ask', 'hm', FROM, TO)).toBeNull()
  })

  it('returns null when there is no active document', () => {
    useDocumentStore.setState({ activeDocumentId: null })
    const { stub } = makeFetchStub()
    vi.stubGlobal('fetch', stub)
    expect(captureAnnotationFromText('ask', 'hm', FROM, TO)).toBeNull()
  })
})

describe('background classification', () => {
  it('(b) classification updates type and status', async () => {
    const { stub } = makeFetchStub({ classifyType: 'dig' })
    vi.stubGlobal('fetch', stub)

    const id = captureAndResolveInBackground('ask', 'tell me more about this', FROM, TO)!
    await waitFor(() => getAnnotation(id).status === 'resolved')

    const ann = getAnnotation(id)
    expect(ann.type).toBe('dig')
    expect(ann.resolution?.content).toBe(STREAMED_ANSWER)
  })

  it('(b) classification failure falls back to suggestedType', async () => {
    const { stub } = makeFetchStub({ classifyType: 'FAIL' })
    vi.stubGlobal('fetch', stub)

    const id = captureAndResolveInBackground('ask', 'dig into this', FROM, TO, {
      suggestedType: 'dig',
    })!
    await waitFor(() => getAnnotation(id).status === 'resolved')
    expect(getAnnotation(id).type).toBe('dig')
  })

  it('(b) classification failure with no suggestedType keeps the provisional type', async () => {
    // classifyAnnotation is invoked with (suggestedType ?? provisionalType) as
    // its fallback hint — same as the pre-split pipeline — so a failed
    // classification round-trip lands back on the captured type.
    const { stub } = makeFetchStub({ classifyType: 'FAIL' })
    vi.stubGlobal('fetch', stub)

    const id = captureAndResolveInBackground('ask', 'hmm', FROM, TO)!
    await waitFor(() => getAnnotation(id).status === 'resolved')
    expect(getAnnotation(id).type).toBe('ask')
  })
})

describe('notify option', () => {
  it("(c) notify:'quiet' dispatches no scroll event, default does", async () => {
    const { stub } = makeFetchStub({ classifyType: 'ask' })
    vi.stubGlobal('fetch', stub)

    const seen: string[] = []
    const listener = (e: Event) => {
      seen.push(String((e as CustomEvent).detail))
    }
    window.addEventListener('intent-ide:scroll-to-annotation', listener)
    try {
      const quietId = captureAndResolveInBackground('ask', 'quiet one', FROM, TO, {
        notify: 'quiet',
      })!
      expect(seen).toEqual([])

      const loudId = captureAndResolveInBackground('ask', 'loud one', FROM, TO)!
      expect(seen).toEqual([loudId])

      await waitFor(
        () =>
          getAnnotation(quietId).status === 'resolved' &&
          getAnnotation(loudId).status === 'resolved',
      )
    } finally {
      window.removeEventListener('intent-ide:scroll-to-annotation', listener)
    }
  })
})

describe('background failure', () => {
  it('(d) a throw during background resolve finalizes with error message + toast', async () => {
    const { stub } = makeFetchStub({ classifyType: 'ask' })
    vi.stubGlobal('fetch', stub)
    resolverControl.streamOverride = () => Promise.reject(new Error('resolver exploded'))

    const id = captureAndResolveInBackground('ask', 'boom please', FROM, TO)!
    await waitFor(() => getAnnotation(id).status === 'resolved')

    const ann = getAnnotation(id)
    const lastAgent = [...ann.conversation].reverse().find((m) => m.role === 'agent')
    expect(lastAgent?.content).toContain('resolver exploded')
    expect(useToastStore.getState().toasts.length).toBeGreaterThan(0)
    expect(useToastStore.getState().toasts[0].type).toBe('error')
  })
})

describe('(f) flow-state answer buffering', () => {
  // Both-paths rule: the fetch stub serves BOTH /api/resolve shapes exactly
  // like the e2e interceptors — the ask scenarios exercise the streaming SSE
  // shape (ask/dig are MADS-'simple' and always stream), while the edit
  // scenario routes through MADS and exercises the non-stream transcript
  // shape. An ask/dig annotation can never reach the MADS path (see
  // classifyComplexity in mads.ts), so the shapes split across types.

  async function runScenario(opts: {
    type: 'ask' | 'edit'
    deactivate: boolean
    bufferEnabled: boolean
  }) {
    useFlowStore.getState().setBufferAnswersEnabled(opts.bufferEnabled)
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const { stub, calls } = makeFetchStub({ resolveGate: gate })
    vi.stubGlobal('fetch', stub)

    const id = captureAndResolveInBackground(opts.type, 'scenario input', FROM, TO, {
      suggestedType: opts.type,
      skipClassify: true,
    })!
    expect(useAnnotationStore.getState().activeAnnotationId).toBe(id)
    if (opts.deactivate) {
      // User moves on before the answer lands.
      useAnnotationStore.getState().setActive(null)
    }
    release()
    await waitFor(() => getAnnotation(id).status === 'resolved')
    return { id, calls }
  }

  it('ask + buffering + inactive card → heldAnswers entry (streaming SSE path)', async () => {
    const { id, calls } = await runScenario({ type: 'ask', deactivate: true, bufferEnabled: true })
    expect(useFlowStore.getState().heldAnswers[id]).toBeDefined()
    expect(useFlowStore.getState().heldAnswers[id].dwellMs).toBeGreaterThanOrEqual(2000)
    // Status is still resolved — buffering suppresses presentation, not existence.
    expect(getAnnotation(id).status).toBe('resolved')
    expect(getAnnotation(id).resolution?.content).toBe(STREAMED_ANSWER)
    // Proves the SSE-shaped stub served this resolution.
    expect(calls.some((c) => c.url.includes('/api/resolve') && c.body?.stream)).toBe(true)
  })

  it('edit type is never held (MADS transcript path)', async () => {
    const { id, calls } = await runScenario({ type: 'edit', deactivate: true, bufferEnabled: true })
    expect(useFlowStore.getState().heldAnswers[id]).toBeUndefined()
    expect(getAnnotation(id).status).toBe('resolved')
    // Proves the MADS-shaped stub served this resolution (three sequential
    // non-stream transcript calls, ending with the Judge).
    const madsCalls = calls.filter(
      (c) =>
        c.url.includes('/api/resolve') &&
        !c.body?.stream &&
        (c.body?.messages ?? []).some((m: { content: string }) =>
          m.content.includes('Issue your verdict'),
        ),
    )
    expect(madsCalls.length).toBe(1)
  })

  it('toggle off never holds', async () => {
    const { id } = await runScenario({ type: 'ask', deactivate: true, bufferEnabled: false })
    expect(useFlowStore.getState().heldAnswers[id]).toBeUndefined()
  })

  it('active card never holds', async () => {
    const { id } = await runScenario({ type: 'ask', deactivate: false, bufferEnabled: true })
    expect(useFlowStore.getState().heldAnswers[id]).toBeUndefined()
  })
})

describe('(g) mermaid guard on resolution content', () => {
  it('an invalid fence triggers exactly one retry, then degrades to a plain fence', async () => {
    const INVALID_DIAGRAM = 'Here is the flow:\n\n```mermaid\ngrph BROKEN\n```\n\nOne caption.'
    // The generic non-stream branch (used by continueThread for the retry)
    // serves the SAME invalid-fence content, so the retry also fails to
    // validate and the ORIGINAL content is degraded.
    const { stub, calls } = makeFetchStub({ streamText: INVALID_DIAGRAM })
    vi.stubGlobal('fetch', stub)

    const id = captureAndResolveInBackground('dig', 'diagram this', FROM, TO, {
      suggestedType: 'dig',
      skipClassify: true,
    })!
    await waitFor(() => getAnnotation(id).status === 'resolved')

    const retries = calls.filter(
      (c) =>
        c.url.includes('/api/resolve') &&
        (c.body?.messages ?? []).some((m: { content: string }) =>
          m.content.includes('The mermaid diagram failed to parse: Parse error: bad node'),
        ),
    )
    expect(retries).toHaveLength(1)

    const content = getAnnotation(id).resolution?.content ?? ''
    expect(content).not.toContain('```mermaid')
    expect(content).toContain('```\ngrph BROKEN\n```')
    expect(content).toContain('Here is the flow:')
    // Presentation-layer message carries the degraded content too.
    const lastAgent = [...getAnnotation(id).conversation].reverse().find((m) => m.role === 'agent')
    expect(lastAgent?.content).toBe(content)
  })

  it('content without a fence never touches the guard (no retry calls)', async () => {
    const { stub, calls } = makeFetchStub()
    vi.stubGlobal('fetch', stub)
    const id = captureAndResolveInBackground('ask', 'plain answer', FROM, TO, {
      suggestedType: 'ask',
      skipClassify: true,
    })!
    await waitFor(() => getAnnotation(id).status === 'resolved')
    expect(getAnnotation(id).resolution?.content).toBe(STREAMED_ANSWER)
    const retries = calls.filter((c) =>
      (c.body?.messages ?? []).some((m: { content: string }) =>
        m.content.includes('failed to parse'),
      ),
    )
    expect(retries).toHaveLength(0)
  })
})

describe('skipClassify', () => {
  it('(e) performs no /api/classify fetch and uses the preset type', async () => {
    const { stub, calls } = makeFetchStub()
    vi.stubGlobal('fetch', stub)

    const id = captureAndResolveInBackground('ask', 'explain this', FROM, TO, {
      suggestedType: 'dig',
      skipClassify: true,
    })!
    await waitFor(() => getAnnotation(id).status === 'resolved')

    expect(getAnnotation(id).type).toBe('dig')
    expect(calls.filter((c) => c.url.includes('/api/classify'))).toHaveLength(0)
  })
})
