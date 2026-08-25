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
  createAnnotationPlugin,
  annotationPluginKey,
} from '@/lib/prosemirror/plugins/annotationPlugin'
import {
  captureAnnotationFromText,
  captureAndResolveInBackground,
  markUserActivated,
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

// Imported after the mock above so this resolves to the same mocked module
// instance validateMermaid's dynamic `await import('mermaid')` returns —
// lets one test override `parse` for a single call via mockImplementationOnce.
import mermaid from 'mermaid'

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
  /** Respond non-ok to ONLY the mermaid-guard's correction retry. */
  failMermaidRetry?: boolean
  /** Respond 200 with blank content to ONLY the mermaid-guard's correction retry. */
  blankMermaidRetry?: boolean
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
      // Only the mermaid-guard's non-streamed correction retry carries this
      // phrase as its LAST message — check the last message specifically so
      // a later, unrelated request whose history merely contains a prior
      // correction can't be mistaken for the retry itself.
      const isMermaidRetry =
        !body?.stream &&
        String((body?.messages ?? []).at(-1)?.content ?? '').includes(
          'The mermaid diagram failed to parse',
        )
      if (options.failMermaidRetry && isMermaidRetry) {
        return { ok: false, status: 500, statusText: 'retry boom', json: async () => ({}) }
      }
      if (options.blankMermaidRetry && isMermaidRetry) {
        return jsonResponse({ content: '', responseId: 'test-resp-1' })
      }
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
      // The real route returns { id }, not { auditId } — logAuditEvent reads
      // data.id, so the wrong key here silently resolved every write to null.
      return jsonResponse({ id: 'audit-test-1' })
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
  // The annotation decoration plugin is mounted so decoration-refresh behavior
  // (mapped anchors across classify) is observable via annotationPluginKey.
  const state = EditorState.create({ schema, doc, plugins: [createAnnotationPlugin()] })
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
    bufferEnabled: boolean
    /** User moves on: setActive(null) before the answer lands. */
    deactivate?: boolean
    /** User deliberately opens the captured card (markUserActivated). */
    userActivate?: boolean
    notify?: 'panel' | 'quiet'
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
      ...(opts.notify ? { notify: opts.notify } : {}),
    })!
    expect(useAnnotationStore.getState().activeAnnotationId).toBe(id)
    if (opts.deactivate) {
      // User moves on before the answer lands.
      useAnnotationStore.getState().setActive(null)
    }
    if (opts.userActivate) {
      // User clicks the card — what AnnotationCard's handleClick records.
      markUserActivated(id)
    }
    release()
    await waitFor(() => getAnnotation(id).status === 'resolved')
    return { id, calls }
  }

  it('H1 core journey: a quiet-captured ask is held at finalize even though capture kept it active', async () => {
    // No setActive(null) workaround — capture's own setActive must NOT count
    // as the user watching the card (capture-driven vs user-driven activation).
    const { id, calls } = await runScenario({
      type: 'ask',
      bufferEnabled: true,
      notify: 'quiet',
    })
    expect(useAnnotationStore.getState().activeAnnotationId).toBe(id)
    expect(useFlowStore.getState().heldAnswers[id]).toBeDefined()
    // Status is still resolved — buffering suppresses presentation, not existence.
    expect(getAnnotation(id).status).toBe('resolved')
    expect(getAnnotation(id).resolution?.content).toBe(STREAMED_ANSWER)
    expect(calls.some((c) => c.url.includes('/api/resolve') && c.body?.stream)).toBe(true)

    // Click-through: AnnotationCard's handleClick releases the hold and clears
    // the capture-activation mark.
    markUserActivated(id)
    useFlowStore.getState().revealAnswer(id)
    expect(useFlowStore.getState().heldAnswers[id]).toBeUndefined()
  })

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

  it('a genuinely user-activated card (markUserActivated) is never held', async () => {
    const { id } = await runScenario({ type: 'ask', userActivate: true, bufferEnabled: true })
    expect(useAnnotationStore.getState().activeAnnotationId).toBe(id)
    expect(useFlowStore.getState().heldAnswers[id]).toBeUndefined()
  })

  it('an annotation deleted mid-resolution (card dismissed while streaming) never gets a heldAnswers entry (#95)', async () => {
    useFlowStore.getState().setBufferAnswersEnabled(true)
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const { stub } = makeFetchStub({ resolveGate: gate })
    vi.stubGlobal('fetch', stub)

    const id = captureAndResolveInBackground('ask', 'about to vanish', FROM, TO, {
      suggestedType: 'ask',
      skipClassify: true,
      notify: 'quiet',
    })!
    // Not watching the card — buffering would normally hold this answer.
    useAnnotationStore.getState().setActive(null)
    // The card is dismissed (e.g. the user deletes the annotation) while the
    // resolve is still in flight, before the flow-buffering block runs.
    useAnnotationStore.getState().remove(id)

    release()
    // No `status === 'resolved'` to poll for once the annotation is gone —
    // wait for the gated /api/resolve call to actually settle instead.
    await new Promise((r) => setTimeout(r, 50))

    expect(useAnnotationStore.getState().getById(id)).toBeUndefined()
    expect(useFlowStore.getState().heldAnswers[id]).toBeUndefined()
  })
})

describe('(h) finalize survives a shrunken doc (stale anchor)', () => {
  it('anchor beyond a shrunken doc: resolution survives, status resolved, no hold, no error toast', async () => {
    useFlowStore.getState().setBufferAnswersEnabled(true)
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const { stub } = makeFetchStub({ resolveGate: gate })
    vi.stubGlobal('fetch', stub)

    // Anchor inside paragraph 2.
    const para2Start = PARA_1.length + 2 // para1 node = 1 + text + 1
    const from = para2Start + 5
    const to = para2Start + 15
    const id = captureAndResolveInBackground('ask', 'about paragraph two', from, to, {
      suggestedType: 'ask',
      skipClassify: true,
      notify: 'quiet',
    })!

    // While the resolve streams, the doc shrinks below the anchor: delete
    // paragraph 2 entirely.
    view.dispatch(view.state.tr.delete(para2Start, view.state.doc.content.size))
    expect(view.state.doc.content.size).toBeLessThan(from)

    release()
    await waitFor(() => getAnnotation(id).status === 'resolved')

    // The streamed answer survived — before the fix, getBlockText's unclamped
    // resolve threw inside the hold branch and the catch discarded it.
    expect(getAnnotation(id).resolution?.content).toBe(STREAMED_ANSWER)
    expect(getAnnotation(id).status).toBe('resolved')
    // No hold against a vanished anchor, and no background-failure toast.
    expect(useFlowStore.getState().heldAnswers[id]).toBeUndefined()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})

describe('(i) decoration refresh after classify uses the mapped anchor', () => {
  it('typing before the anchor during classify: the re-typed decoration sits at the mapped range', async () => {
    let releaseClassify!: () => void
    const classifyGate = new Promise<void>((r) => {
      releaseClassify = r
    })
    const { stub } = makeFetchStub({ classifyGate, classifyType: 'dig' })
    vi.stubGlobal('fetch', stub)

    const from = 5
    const to = 10
    const id = captureAndResolveInBackground('ask', 'what is this', from, to)!

    // Plugin holds the decoration at the captured range.
    let pluginState = annotationPluginKey.getState(view.state)!
    expect(pluginState.anchors.get(id)).toMatchObject({ from, to, type: 'ask' })

    // While classify is in flight, the user types BEFORE the anchor — the
    // plugin maps the anchor forward by the inserted length.
    const INSERT = 'XYZ '
    view.dispatch(view.state.tr.insertText(INSERT, 1))
    pluginState = annotationPluginKey.getState(view.state)!
    expect(pluginState.anchors.get(id)).toMatchObject({
      from: from + INSERT.length,
      to: to + INSERT.length,
    })

    releaseClassify()
    await waitFor(() => getAnnotation(id).status === 'resolved')
    expect(getAnnotation(id).type).toBe('dig')

    // The classify type-change refresh must have re-decorated at the MAPPED
    // range, not the stale stored anchor (from/to at capture time).
    pluginState = annotationPluginKey.getState(view.state)!
    expect(pluginState.anchors.get(id)).toMatchObject({
      from: from + INSERT.length,
      to: to + INSERT.length,
      type: 'dig',
    })
    const deco = pluginState.decorations
      .find()
      .find((d) => (d.spec as { annotationId?: string }).annotationId === id)
    expect(deco).toBeDefined()
    expect(deco!.from).toBe(from + INSERT.length)
    expect(deco!.to).toBe(to + INSERT.length)
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
    // The correction prompt must carry the actual broken diagram source —
    // otherwise the model is asked to fix a diagram it has never seen.
    const retryMessages = retries[0].body?.messages ?? []
    expect(
      retryMessages.some((m: { content: string }) => m.content.includes('grph BROKEN')),
    ).toBe(true)

    const content = getAnnotation(id).resolution?.content ?? ''
    expect(content).not.toContain('```mermaid')
    expect(content).toContain('```\ngrph BROKEN\n```')
    expect(content).toContain('Here is the flow:')
    // Presentation-layer message carries the degraded content too.
    const lastAgent = [...getAnnotation(id).conversation].reverse().find((m) => m.role === 'agent')
    expect(lastAgent?.content).toBe(content)
  })

  it('a retry whose own /api/resolve call fails degrades the ORIGINAL answer instead of replacing it with the error string', async () => {
    const INVALID_DIAGRAM = 'Here is the flow:\n\n```mermaid\ngrph BROKEN\n```\n\nOne caption.'
    // continueThread reports a failed /api/resolve as an error-shaped message
    // rather than throwing. That message carries no mermaid fence, so before
    // the requestFailed signal existed the guard read it as a deliberate
    // plain-prose retry and returned it as the final answer.
    const { stub } = makeFetchStub({ streamText: INVALID_DIAGRAM, failMermaidRetry: true })
    vi.stubGlobal('fetch', stub)

    const id = captureAndResolveInBackground('dig', 'diagram this', FROM, TO, {
      suggestedType: 'dig',
      skipClassify: true,
    })!
    await waitFor(() => getAnnotation(id).status === 'resolved')

    const content = getAnnotation(id).resolution?.content ?? ''
    expect(content).not.toContain('Thread continuation failed')
    expect(content).toContain('Here is the flow:')
    expect(content).toContain('One caption.')
    // Degraded, not raw: the broken source survives as a plain code block.
    expect(content).not.toContain('```mermaid')
    expect(content).toContain('```\ngrph BROKEN\n```')
  })

  it('a retry that resolves 200 with blank content degrades the ORIGINAL answer instead of returning blank', async () => {
    const INVALID_DIAGRAM = 'Here is the flow:\n\n```mermaid\ngrph BROKEN\n```\n\nOne caption.'
    // A blank-but-ok retry is not something the caller can throw on — the
    // guard itself must refuse to trust it as a deliberate plain-prose reply.
    const { stub } = makeFetchStub({ streamText: INVALID_DIAGRAM, blankMermaidRetry: true })
    vi.stubGlobal('fetch', stub)

    const id = captureAndResolveInBackground('dig', 'diagram this', FROM, TO, {
      suggestedType: 'dig',
      skipClassify: true,
    })!
    await waitFor(() => getAnnotation(id).status === 'resolved')

    const content = getAnnotation(id).resolution?.content ?? ''
    expect(content).toBeTruthy()
    expect(content).toContain('Here is the flow:')
    expect(content).toContain('One caption.')
    expect(content).not.toContain('```mermaid')
    expect(content).toContain('```\ngrph BROKEN\n```')
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

  it('surfaces a toast when the correction retry\'s own audit write fails', async () => {
    const INVALID_DIAGRAM = 'Here is the flow:\n\n```mermaid\ngrph BROKEN\n```\n\nOne caption.'
    const { stub } = makeFetchStub({ streamText: INVALID_DIAGRAM })
    // Force only /api/audit to fail (resolve with no id) — everything else
    // uses the normal stub responses, including the retry's /api/resolve call.
    const stubWithFailingAudit = vi.fn(async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? input)
      if (url.includes('/api/audit')) {
        return jsonResponse({})
      }
      return stub(input, init)
    })
    vi.stubGlobal('fetch', stubWithFailingAudit)

    const id = captureAndResolveInBackground('dig', 'diagram this', FROM, TO, {
      suggestedType: 'dig',
      skipClassify: true,
    })!
    await waitFor(() => getAnnotation(id).status === 'resolved')

    // The guard's own job (degrading the fence) still completes correctly —
    // this fix only adds a failure signal, it never changes the content.
    expect(getAnnotation(id).resolution?.content).not.toContain('```mermaid')

    // The correction message is discarded by the pipeline (only `.content`
    // survives) and is never added to the annotation's conversation, so the
    // toast is the ONLY way this failure could ever reach the user.
    await waitFor(() => useToastStore.getState().toasts.some((t) => t.type === 'error'))
    const errorToast = useToastStore.getState().toasts.find((t) => t.type === 'error')
    expect(errorToast?.message).toMatch(/mermaid/i)
    expect(
      getAnnotation(id).conversation.some((m) => 'auditFailed' in m),
    ).toBe(false)
  })

  it('an annotation removed between the stream resolving and the retry firing never sends a correction request for a diagram it never saw (#91)', async () => {
    const INVALID_DIAGRAM = 'Here is the flow:\n\n```mermaid\ngrph BROKEN\n```\n\nOne caption.'
    const { stub, calls } = makeFetchStub({ streamText: INVALID_DIAGRAM })
    vi.stubGlobal('fetch', stub)

    // The mermaid guard calls validateMermaid → mermaid.parse() BEFORE the
    // pipeline's retry callback runs — the exact "between the stream
    // finishing and the retry firing" window the issue describes. Deleting
    // the annotation from inside this one-shot parse failure reproduces the
    // real "user dismissed the card mid-flight" race deterministically,
    // without a fixed sleep.
    let targetId = ''
    vi.mocked(mermaid.parse).mockImplementationOnce(async () => {
      if (targetId) useAnnotationStore.getState().remove(targetId)
      throw new Error('Parse error: bad node')
    })

    const id = captureAndResolveInBackground('dig', 'diagram this', FROM, TO, {
      suggestedType: 'dig',
      skipClassify: true,
    })!
    targetId = id

    // The annotation is gone, so there is no `status === 'resolved'` to poll
    // for — wait for the (only expected) initial /api/resolve call, then give
    // an incorrect retry a window to have fired before asserting it didn't.
    await waitFor(() => calls.some((c) => c.url.includes('/api/resolve')))
    await new Promise((r) => setTimeout(r, 50))

    expect(useAnnotationStore.getState().getById(id)).toBeUndefined()
    const retryCalls = calls.filter(
      (c) =>
        c.url.includes('/api/resolve') &&
        (c.body?.messages ?? []).some((m: { content: string }) =>
          m.content.includes('The mermaid diagram failed to parse'),
        ),
    )
    expect(retryCalls).toHaveLength(0)
    expect(calls.filter((c) => c.url.includes('/api/resolve'))).toHaveLength(1)
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
