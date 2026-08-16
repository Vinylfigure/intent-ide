// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { schema } from '@/lib/prosemirror/schema'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useEditorStore } from '@/stores/editorStore'
import { useDocumentStore } from '@/stores/documentStore'
import { useToastStore } from '@/stores/toastStore'
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
