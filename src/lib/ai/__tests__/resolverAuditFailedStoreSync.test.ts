import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { schema } from '@/lib/prosemirror/schema'
import type { Annotation } from '@/lib/annotations/types'

// #77: `auditFailed` was set correctly on the Resolution/ConversationMessage
// object (fixed by #72/PR76), but the mutation never reached the reactive
// store — no subscriber was notified and the persisted localStorage snapshot
// never picked it up. These tests drive both possible orderings between "the
// resolution/message gets stored" and "the audit write settles", since the
// store-sync call is a no-op if the annotation isn't in the store yet (the
// direct object mutation is what carries the flag across in that ordering).
vi.mock('@/lib/audit/auditLogger', () => ({
  logResolutionAudit: vi.fn(),
}))

vi.mock('@/lib/ai/mads', () => ({
  runMADS: vi.fn(),
}))

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string) {
    return this.store.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.store.set(key, value)
  }
  removeItem(key: string) {
    this.store.delete(key)
  }
  clear() {
    this.store.clear()
  }
}

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'ann-1',
    documentId: 'doc-1',
    locationGroupKey: 'doc-1:1:10',
    type: 'flag',
    status: 'resolving',
    transcript: 'Original question',
    anchor: { from: 1, to: 5, scope: 'sentence', text: 'Some text' },
    resolution: null,
    conversation: [],
    parentId: null,
    childIds: [],
    createdAt: 100,
    resolvedAt: null,
    verbosity: 'normal',
    ...overrides,
  }
}

function makeEditorState(): EditorState {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', { blockId: 'b1' }, [schema.text('Some text here.')]),
  ])
  return EditorState.create({ schema, doc })
}

async function loadModules() {
  vi.resetModules()
  const auditLogger = await import('@/lib/audit/auditLogger')
  const mads = await import('@/lib/ai/mads')
  const resolver = await import('@/lib/ai/resolver')
  const annotationStoreMod = await import('@/stores/annotationStore')
  return { auditLogger, mads, resolver, annotationStoreMod }
}

function stubFetchJson(content: string, responseId = 'resp-1') {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      statusText: 'OK',
      json: async () => ({ content, responseId }),
    }),
  )
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('localStorage', new MemoryStorage())
})

describe('resolveAnnotation → annotationStore audit-status sync (#77)', () => {
  it('reaches the store when the resolution was already stored before the audit write settles (ordering A)', async () => {
    const { auditLogger, mads, resolver, annotationStoreMod } = await loadModules()
    vi.mocked(mads.runMADS).mockResolvedValue(null)
    stubFetchJson('single-agent reply')

    let resolveAudit!: (v: string | null) => void
    vi.mocked(auditLogger.logResolutionAudit).mockReturnValue(
      new Promise<string | null>((resolve) => {
        resolveAudit = resolve
      }),
    )

    const annotation = makeAnnotation()
    const resolution = await resolver.resolveAnnotation(annotation, makeEditorState())

    // The caller (pipeline.ts / AnnotationCard.tsx) stores the resolution
    // synchronously once resolveAnnotation resolves — before the still-pending
    // fire-and-forget audit write has any chance to settle.
    const store = annotationStoreMod.useAnnotationStore
    store.getState().add(annotation)
    store.getState().update(annotation.id, { status: 'resolved', resolution, resolvedAt: Date.now() })

    // logAuditEvent never rejects on a real write failure — it resolves null.
    resolveAudit(null)
    await flushMicrotasks()

    const stored = store.getState().getById(annotation.id)
    expect(stored?.resolution?.auditFailed).toBe(true)
    expect(stored?.resolution?.auditId).toBeUndefined()
    // A NEW resolution object — proof that `set()` fired (subscriber/persist
    // notified), not just that the original object was mutated in place.
    expect(stored?.resolution).not.toBe(resolution)

    // Outlives a simulated rehydration: read what actually landed in
    // localStorage and confirm the flag survived the persist round-trip.
    const raw = (globalThis.localStorage as unknown as MemoryStorage).getItem('intent-ide-annotations')
    expect(raw).not.toBeNull()
    const persisted = JSON.parse(raw as string)
    const persistedAnnotation = persisted.state.annotations.find((a: Annotation) => a.id === annotation.id)
    expect(persistedAnnotation.resolution.auditFailed).toBe(true)
  })

  it('preserves the flag on the resolution object when the audit write settles before the resolution is ever stored (ordering B)', async () => {
    const { auditLogger, mads, resolver, annotationStoreMod } = await loadModules()
    vi.mocked(mads.runMADS).mockResolvedValue(null)
    stubFetchJson('single-agent reply')

    let resolveAudit!: (v: string | null) => void
    vi.mocked(auditLogger.logResolutionAudit).mockReturnValue(
      new Promise<string | null>((resolve) => {
        resolveAudit = resolve
      }),
    )

    const annotation = makeAnnotation()
    const resolution = await resolver.resolveAnnotation(annotation, makeEditorState())

    // Resolve the audit write and let its .then() run BEFORE the annotation
    // is stored anywhere — updateResolutionAuditStatus is a guaranteed no-op
    // here (nothing in the store yet), so this only passes if the direct
    // object mutation in resolver.ts is still in place as a fallback.
    resolveAudit(null)
    await flushMicrotasks()

    const store = annotationStoreMod.useAnnotationStore
    store.getState().add(annotation)
    store.getState().update(annotation.id, { status: 'resolved', resolution, resolvedAt: Date.now() })

    const stored = store.getState().getById(annotation.id)
    expect(stored?.resolution?.auditFailed).toBe(true)
  })

  it('does not stomp a newer resolution (e.g. a badge-override re-resolve) with a stale audit outcome', async () => {
    const { auditLogger, mads, resolver, annotationStoreMod } = await loadModules()
    vi.mocked(mads.runMADS).mockResolvedValue(null)
    stubFetchJson('first reply')

    let resolveAudit!: (v: string | null) => void
    vi.mocked(auditLogger.logResolutionAudit).mockReturnValue(
      new Promise<string | null>((resolve) => {
        resolveAudit = resolve
      }),
    )

    const annotation = makeAnnotation()
    const staleResolution = await resolver.resolveAnnotation(annotation, makeEditorState())

    const store = annotationStoreMod.useAnnotationStore
    store.getState().add(annotation)
    store.getState().update(annotation.id, { status: 'resolved', resolution: staleResolution, resolvedAt: Date.now() })

    // A newer resolution (e.g. a badge-override re-run) replaces it before
    // the first resolution's audit write settles.
    const freshResolution = { ...staleResolution, content: 'fresh reply' }
    store.getState().update(annotation.id, { resolution: freshResolution })

    resolveAudit(null)
    await flushMicrotasks()

    const stored = store.getState().getById(annotation.id)
    // The stale write's outcome must not land on the fresh resolution.
    expect(stored?.resolution).toBe(freshResolution)
    expect(stored?.resolution?.auditFailed).toBeUndefined()
  })
})

describe('continueThread → annotationStore audit-status sync (#77)', () => {
  it('reaches the store when the message was already stored before the audit write settles (ordering A)', async () => {
    const { auditLogger, resolver, annotationStoreMod } = await loadModules()
    stubFetchJson('follow-up reply')

    let resolveAudit!: (v: string | null) => void
    vi.mocked(auditLogger.logResolutionAudit).mockReturnValue(
      new Promise<string | null>((resolve) => {
        resolveAudit = resolve
      }),
    )

    const annotation = makeAnnotation()
    const store = annotationStoreMod.useAnnotationStore
    store.getState().add(annotation)

    const message = await resolver.continueThread(annotation, 'What about edge cases?', makeEditorState())
    store.getState().addMessage(annotation.id, message)

    resolveAudit(null)
    await flushMicrotasks()

    const stored = store.getState().getById(annotation.id)
    const storedMessage = stored?.conversation.find((m) => m.id === message.id)
    expect(storedMessage?.auditFailed).toBe(true)

    const raw = (globalThis.localStorage as unknown as MemoryStorage).getItem('intent-ide-annotations')
    const persisted = JSON.parse(raw as string)
    const persistedAnnotation = persisted.state.annotations.find((a: Annotation) => a.id === annotation.id)
    expect(persistedAnnotation.conversation.find((m: { id: string }) => m.id === message.id).auditFailed).toBe(true)
  })

  it('preserves the flag on the message object when the audit write settles before the message is ever stored (ordering B)', async () => {
    const { auditLogger, resolver, annotationStoreMod } = await loadModules()
    stubFetchJson('follow-up reply')

    let resolveAudit!: (v: string | null) => void
    vi.mocked(auditLogger.logResolutionAudit).mockReturnValue(
      new Promise<string | null>((resolve) => {
        resolveAudit = resolve
      }),
    )

    const annotation = makeAnnotation()
    const message = await resolver.continueThread(annotation, 'What about edge cases?', makeEditorState())

    resolveAudit(null)
    await flushMicrotasks()

    const store = annotationStoreMod.useAnnotationStore
    store.getState().add(annotation)
    store.getState().addMessage(annotation.id, message)

    const stored = store.getState().getById(annotation.id)
    const storedMessage = stored?.conversation.find((m) => m.id === message.id)
    expect(storedMessage?.auditFailed).toBe(true)
  })
})
