import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { schema } from '@/lib/prosemirror/schema'
import type { Annotation } from '@/lib/annotations/types'

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

vi.mock('@/lib/audit/auditLogger', () => ({
  logResolutionAudit: vi.fn(),
}))

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'ann-1',
    documentId: 'doc-1',
    locationGroupKey: 'doc-1:1:10',
    type: 'flag',
    status: 'resolved',
    transcript: 'Original question',
    anchor: { from: 1, to: 5, scope: 'sentence', text: 'Some text' },
    resolution: null,
    conversation: [],
    parentId: null,
    childIds: [],
    createdAt: 100,
    resolvedAt: 200,
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
  const resolver = await import('@/lib/ai/resolver')
  const changesStore = await import('@/stores/changesStore')
  return { auditLogger, resolver, changesStore }
}

function stubFetch(content: string, responseId = 'resp-1') {
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
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('localStorage', new MemoryStorage())
})

describe('continueThread audit logging', () => {
  it('writes an audit record for a follow-up thread message and links it to the annotation', async () => {
    const { auditLogger, resolver, changesStore } = await loadModules()
    vi.mocked(auditLogger.logResolutionAudit).mockResolvedValue('audit-99')
    stubFetch('Follow-up agent reply')

    const annotation = makeAnnotation()
    const message = await resolver.continueThread(annotation, 'What about edge cases?', makeEditorState())

    expect(message.content).toBe('Follow-up agent reply')
    expect(auditLogger.logResolutionAudit).toHaveBeenCalledTimes(1)
    expect(auditLogger.logResolutionAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        annotationType: 'flag',
        transcript: 'What about edge cases?',
        responseId: 'resp-1',
        usedMADS: false,
      }),
    )

    await flushMicrotasks()

    expect(message.auditId).toBe('audit-99')
    expect(message.auditFailed).toBeUndefined()

    const changeSet = changesStore.useChangesStore.getState().getChangeSetByAnnotationId(annotation.id)
    expect(changeSet?.auditRecordIds).toContain('audit-99')
  })

  it('flags auditFailed when the audit write resolves null — the real failure signal, since logResolutionAudit never rejects on a write failure', async () => {
    const { auditLogger, resolver } = await loadModules()
    // logAuditEvent's own try/catch swallows every real failure and resolves null;
    // it never rejects. A test that only exercised .catch() would assert a mode the
    // real implementation can't produce and miss this actual failure path.
    vi.mocked(auditLogger.logResolutionAudit).mockResolvedValue(null)
    stubFetch('Follow-up agent reply')

    const annotation = makeAnnotation()
    const message = await resolver.continueThread(annotation, 'Another follow-up', makeEditorState())

    expect(message.content).toBe('Follow-up agent reply')

    await flushMicrotasks()

    expect(message.auditFailed).toBe(true)
    expect(message.auditId).toBeUndefined()
  })

  it('flags auditFailed as a defensive backstop if logResolutionAudit unexpectedly throws', async () => {
    const { auditLogger, resolver } = await loadModules()
    vi.mocked(auditLogger.logResolutionAudit).mockRejectedValue(new Error('unexpected throw'))
    stubFetch('Follow-up agent reply')

    const annotation = makeAnnotation()
    const message = await resolver.continueThread(annotation, 'Yet another follow-up', makeEditorState())

    expect(message.content).toBe('Follow-up agent reply')

    await flushMicrotasks()

    expect(message.auditFailed).toBe(true)
    expect(message.auditId).toBeUndefined()
  })
})
