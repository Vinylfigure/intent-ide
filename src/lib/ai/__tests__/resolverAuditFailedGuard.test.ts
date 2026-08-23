import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { schema } from '@/lib/prosemirror/schema'
import type { Annotation, Resolution } from '@/lib/annotations/types'

// logAuditEvent's own try/catch swallows every real write failure and
// resolves null — it never rejects. Mocking logResolutionAudit at the
// module boundary lets each scenario drive both the real failure mode
// (resolves null) and the defensive-backstop mode (throws) independently
// of what the underlying auditLogger implementation can actually produce.
vi.mock('@/lib/audit/auditLogger', () => ({
  logResolutionAudit: vi.fn(),
}))

// MADS is attempted unconditionally at the top of both resolveAnnotation and
// streamResolveAnnotation; mocking it lets a single test target either the
// MADS branch (non-null return) or the single-agent branch (null return)
// without depending on the real debate pipeline.
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
  const mads = await import('@/lib/ai/mads')
  const resolver = await import('@/lib/ai/resolver')
  return { auditLogger, mads, resolver }
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

// The real streamResolveAnnotation parses an SSE body via response.body.getReader();
// a minimal single-chunk reader stub is enough to drive it to a resolved Resolution.
function stubFetchSSE(content: string, responseId = 'resp-1') {
  const sseBody = `data: ${JSON.stringify({ responseId })}\n\ndata: ${JSON.stringify({ text: content })}\n\n`
  const bytes = new TextEncoder().encode(sseBody)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      statusText: 'OK',
      body: {
        getReader() {
          let delivered = false
          return {
            read: async () => {
              if (delivered) return { done: true, value: undefined }
              delivered = true
              return { done: false, value: bytes }
            },
          }
        },
      },
    }),
  )
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

const noopOnChunk = () => {}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('localStorage', new MemoryStorage())
})

type Mods = Awaited<ReturnType<typeof loadModules>>

const madsResolution: Resolution = {
  type: 'edit',
  content: 'MADS reply',
  suggestedEdit: null,
  actions: [],
}

const scenarios: Array<{
  name: string
  run: (mods: Mods, annotation: Annotation) => Promise<Resolution>
}> = [
  {
    name: 'resolveAnnotation MADS branch',
    run: async (mods, annotation) => {
      vi.mocked(mods.mads.runMADS).mockResolvedValue({
        resolution: { ...madsResolution },
        uncertaintyFlags: [],
        debateLog: '',
        usedMADS: true,
      })
      return mods.resolver.resolveAnnotation(annotation, makeEditorState())
    },
  },
  {
    name: 'resolveAnnotation single-agent branch',
    run: async (mods, annotation) => {
      vi.mocked(mods.mads.runMADS).mockResolvedValue(null)
      stubFetchJson('single-agent reply')
      return mods.resolver.resolveAnnotation(annotation, makeEditorState())
    },
  },
  {
    name: 'streamResolveAnnotation MADS branch',
    run: async (mods, annotation) => {
      vi.mocked(mods.mads.runMADS).mockResolvedValue({
        resolution: { ...madsResolution },
        uncertaintyFlags: [],
        debateLog: '',
        usedMADS: true,
      })
      return mods.resolver.streamResolveAnnotation(annotation, makeEditorState(), noopOnChunk)
    },
  },
  {
    name: 'streamResolveAnnotation single-agent branch',
    run: async (mods, annotation) => {
      vi.mocked(mods.mads.runMADS).mockResolvedValue(null)
      stubFetchSSE('single-agent stream reply')
      return mods.resolver.streamResolveAnnotation(annotation, makeEditorState(), noopOnChunk)
    },
  },
]

describe('resolver audit-failed guard (issue #72)', () => {
  for (const scenario of scenarios) {
    it(`${scenario.name}: flags auditFailed when the audit write resolves null (the real failure signal)`, async () => {
      const mods = await loadModules()
      // logAuditEvent never rejects on a real write failure — it resolves null.
      // A test that only exercised .mockRejectedValue would assert a mode the
      // real implementation can't produce and miss this actual failure path.
      vi.mocked(mods.auditLogger.logResolutionAudit).mockResolvedValue(null)

      const resolution = await scenario.run(mods, makeAnnotation())
      await flushMicrotasks()

      expect(resolution.auditFailed).toBe(true)
      expect(resolution.auditId).toBeUndefined()
    })

    it(`${scenario.name}: flags auditFailed as a defensive backstop if logResolutionAudit unexpectedly throws`, async () => {
      const mods = await loadModules()
      vi.mocked(mods.auditLogger.logResolutionAudit).mockRejectedValue(new Error('unexpected throw'))

      const resolution = await scenario.run(mods, makeAnnotation())
      await flushMicrotasks()

      expect(resolution.auditFailed).toBe(true)
      expect(resolution.auditId).toBeUndefined()
    })

    it(`${scenario.name}: sets auditId (not auditFailed) on a successful write`, async () => {
      const mods = await loadModules()
      vi.mocked(mods.auditLogger.logResolutionAudit).mockResolvedValue('audit-1')

      const resolution = await scenario.run(mods, makeAnnotation())
      await flushMicrotasks()

      expect(resolution.auditId).toBe('audit-1')
      expect(resolution.auditFailed).toBeUndefined()
    })
  }
})
