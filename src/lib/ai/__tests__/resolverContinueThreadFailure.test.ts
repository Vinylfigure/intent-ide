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
  logResolutionAudit: vi.fn().mockResolvedValue('audit-1'),
}))

function makeAnnotation(): Annotation {
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
  }
}

function makeEditorState(): EditorState {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', { blockId: 'b1' }, [schema.text('Some text here.')]),
  ])
  return EditorState.create({ schema, doc })
}

async function loadResolver() {
  vi.resetModules()
  return import('@/lib/ai/resolver')
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('localStorage', new MemoryStorage())
})

describe('continueThread requestFailed signal', () => {
  it('flags requestFailed when /api/resolve responds non-ok', async () => {
    const resolver = await loadResolver()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'boom', json: async () => ({}) }),
    )

    const message = await resolver.continueThread(makeAnnotation(), 'follow-up', makeEditorState())

    expect(message.requestFailed).toBe(true)
    expect(message.content).toContain('Error:')
  })

  it('flags requestFailed when the fetch itself rejects', async () => {
    const resolver = await loadResolver()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const message = await resolver.continueThread(makeAnnotation(), 'follow-up', makeEditorState())

    expect(message.requestFailed).toBe(true)
    expect(message.content).toContain('network down')
  })

  it('leaves requestFailed unset on a successful reply, including one that reads like an error', async () => {
    const resolver = await loadResolver()
    // A model is free to answer with prose beginning "Error:" — content alone
    // cannot distinguish a real answer from the catch block's placeholder,
    // which is exactly why the flag exists.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        statusText: 'OK',
        json: async () => ({ content: 'Error: is the wrong word here.', responseId: 'resp-1' }),
      }),
    )

    const message = await resolver.continueThread(makeAnnotation(), 'follow-up', makeEditorState())

    expect(message.requestFailed).toBeUndefined()
    expect(message.content).toBe('Error: is the wrong word here.')
  })
})
