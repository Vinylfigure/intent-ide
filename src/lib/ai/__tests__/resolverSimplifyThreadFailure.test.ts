import { beforeEach, describe, expect, it, vi } from 'vitest'
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
    conversation: [
      { id: 'm1', role: 'user', content: 'First message', suggestedEdit: null, timestamp: 1 },
      { id: 'm2', role: 'agent', content: 'First reply', suggestedEdit: null, timestamp: 2 },
      { id: 'm3', role: 'user', content: 'Second message', suggestedEdit: null, timestamp: 3 },
    ],
    parentId: null,
    childIds: [],
    createdAt: 100,
    resolvedAt: 200,
    verbosity: 'normal',
  }
}

async function loadResolver() {
  vi.resetModules()
  return import('@/lib/ai/resolver')
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('localStorage', new MemoryStorage())
})

describe('simplifyThread requestFailed signal (#88)', () => {
  it('flags requestFailed when /api/resolve responds non-ok, and the error text never becomes content silently', async () => {
    const resolver = await loadResolver()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'boom', json: async () => ({}) }),
    )

    const result = await resolver.simplifyThread(makeAnnotation())

    expect(result.requestFailed).toBe(true)
    expect(result.content).toContain('Error:')
  })

  it('flags requestFailed when the fetch itself rejects', async () => {
    const resolver = await loadResolver()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const result = await resolver.simplifyThread(makeAnnotation())

    expect(result.requestFailed).toBe(true)
    expect(result.content).toContain('network down')
  })

  it('flags requestFailed on a 200 response with no usable content (e.g. a tool-call-only completion)', async () => {
    const resolver = await loadResolver()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        statusText: 'OK',
        json: async () => ({ content: null }),
      }),
    )

    const result = await resolver.simplifyThread(makeAnnotation())

    expect(result.requestFailed).toBe(true)
  })

  it('flags requestFailed on a 200 response with an empty-string content', async () => {
    const resolver = await loadResolver()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        statusText: 'OK',
        json: async () => ({ content: '   ' }),
      }),
    )

    const result = await resolver.simplifyThread(makeAnnotation())

    expect(result.requestFailed).toBe(true)
  })

  it('leaves requestFailed unset on a successful reply, including one that reads like an error', async () => {
    const resolver = await loadResolver()
    // A model is free to summarize starting with the word "Error" (e.g. discussing
    // an error the user reported) — content alone cannot distinguish that from
    // the catch block's placeholder, which is exactly why the flag exists.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        statusText: 'OK',
        json: async () => ({ content: 'Error: is the wrong word to use here.' }),
      }),
    )

    const result = await resolver.simplifyThread(makeAnnotation())

    expect(result.requestFailed).toBeUndefined()
    expect(result.content).toBe('Error: is the wrong word to use here.')
  })
})
