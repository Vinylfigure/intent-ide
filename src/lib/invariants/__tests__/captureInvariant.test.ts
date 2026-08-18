import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureInvariant, listInvariants, recordInvariant, type Invariant } from '../captureInvariant'

// ---------------------------------------------------------------------------
// In-memory fetch double for /api/invariants — mirrors the real route's
// contract (append-only create + list) closely enough to exercise the client
// wrapper without re-testing the route itself (covered in route.test.ts).
// ---------------------------------------------------------------------------

let store: Invariant[] = []
let nextId = 0
let failNextPost = false

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function fetchStub(url: string, init?: RequestInit) {
  if (init?.method === 'POST') {
    if (failNextPost) {
      failNextPost = false
      return Promise.resolve(jsonResponse({ error: 'boom' }, 500))
    }
    const body = JSON.parse(String(init.body))
    const invariant: Invariant = {
      id: `inv-${nextId++}`,
      documentId: body.documentId,
      statement: body.statement,
      blockIds: JSON.stringify(body.blockIds ?? []),
      checkKind: body.checkKind ?? 'deterministic',
      status: 'active',
      provenanceCommitHash: body.provenanceCommitHash ?? null,
      createdAt: new Date(1700000000000 + nextId * 1000).toISOString(),
    }
    store.push(invariant)
    return Promise.resolve(jsonResponse({ invariant }))
  }
  // GET
  const documentId = new URL(url, 'http://localhost').searchParams.get('documentId')
  const invariants = [...store]
    .filter((r) => r.documentId === documentId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  return Promise.resolve(jsonResponse({ invariants }))
}

beforeEach(() => {
  store = []
  nextId = 0
  failNextPost = false
  vi.stubGlobal('fetch', vi.fn(fetchStub))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('captureInvariant', () => {
  it('POSTs the declared fact and returns the stored row — the founder fixture', async () => {
    const invariant = await captureInvariant({
      documentId: 'doc-1',
      statement: 'Terminations are now 30 days.',
      blockIds: ['blk-terminations'],
      provenanceCommitHash: 'commit-abc',
    })
    expect(invariant.statement).toBe('Terminations are now 30 days.')
    expect(JSON.parse(invariant.blockIds)).toEqual(['blk-terminations'])
    expect(invariant.provenanceCommitHash).toBe('commit-abc')
    expect(fetch).toHaveBeenCalledWith(
      '/api/invariants',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('throws on a failed capture', async () => {
    failNextPost = true
    await expect(
      captureInvariant({ documentId: 'doc-1', statement: 'A fact.' }),
    ).rejects.toThrow('boom')
  })
})

describe('recordInvariant', () => {
  // recordInvariant no-ops outside a browser (vitest's environment is
  // 'node'); stub `window` so these tests exercise the real capture path,
  // matching how it runs in the SemanticCommitModal confirm handler.
  beforeEach(() => {
    vi.stubGlobal('window', {})
  })

  it('fires the capture (fire-and-forget) — this is the call SemanticCommitModal confirm makes', async () => {
    recordInvariant({ documentId: 'doc-1', statement: 'Terminations are now 30 days.' })
    // Let the fire-and-forget promise chain flush.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store).toHaveLength(1)
    expect(store[0].statement).toBe('Terminations are now 30 days.')
  })

  it('never throws into the caller even when the capture fails', async () => {
    failNextPost = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() =>
      recordInvariant({ documentId: 'doc-1', statement: 'A fact.' }),
    ).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('listInvariants', () => {
  it('round-trips every fact declared for a document, newest first', async () => {
    await captureInvariant({
      documentId: 'doc-1',
      statement: 'Terminations are now 30 days.',
      blockIds: ['blk-terminations'],
    })
    await captureInvariant({ documentId: 'doc-2', statement: 'Unrelated fact.' })
    await captureInvariant({
      documentId: 'doc-1',
      statement: 'Termination notices go through HR.',
      blockIds: ['blk-hr'],
    })

    const invariants = await listInvariants('doc-1')
    expect(invariants).toHaveLength(2)
    expect(invariants[0].statement).toBe('Termination notices go through HR.')
    expect(invariants[1].statement).toBe('Terminations are now 30 days.')
    expect(JSON.parse(invariants[1].blockIds)).toEqual(['blk-terminations'])
  })
})
