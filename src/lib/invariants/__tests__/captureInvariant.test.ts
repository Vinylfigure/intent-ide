import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  captureInvariant,
  listInvariants,
  recordInvariant,
  resolveInvariant,
  shouldCaptureInvariant,
  type Invariant,
} from '../captureInvariant'

// ---------------------------------------------------------------------------
// In-memory fetch double for /api/invariants — mirrors the real route's
// contract (append-only create + list) closely enough to exercise the client
// wrapper without re-testing the route itself (covered in route.test.ts).
// ---------------------------------------------------------------------------

const MOCK_PAGE_SIZE = 2

let store: Invariant[] = []
let nextId = 0
let failNextPost = false
let failNextResolve = false

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function fetchStub(url: string, init?: RequestInit) {
  const path = new URL(url, 'http://localhost').pathname

  if (init?.method === 'POST' && path === '/api/invariants/resolve') {
    if (failNextResolve) {
      failNextResolve = false
      return Promise.resolve(jsonResponse({ error: 'boom' }, 500))
    }
    const body = JSON.parse(String(init.body))
    const target = store.find((r) => r.id === body.invariantId && r.documentId === body.documentId)
    if (!target) return Promise.resolve(jsonResponse({ error: 'invariant not found' }, 404))
    const invariant: Invariant = {
      id: `inv-${nextId++}`,
      documentId: target.documentId,
      statement: target.statement,
      blockIds: target.blockIds,
      checkKind: target.checkKind,
      status: body.status,
      provenanceCommitHash: target.provenanceCommitHash,
      supersedesId: target.id,
      createdAt: new Date(1700000000000 + nextId * 1000).toISOString(),
    }
    store.push(invariant)
    return Promise.resolve(jsonResponse({ invariant }))
  }

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
      supersedesId: null,
      createdAt: new Date(1700000000000 + nextId * 1000).toISOString(),
    }
    store.push(invariant)
    return Promise.resolve(jsonResponse({ invariant }))
  }
  // GET — mirrors the real route's "exclude superseded rows" + before/beforeId
  // cursor computation (see route.test.ts for the route's own coverage,
  // including the supersede-scan-cap/tiebreak edge cases). MOCK_PAGE_SIZE is
  // deliberately much smaller than the route's real DEFAULT_LIMIT/MAX_LIMIT —
  // this file is only pinning listInvariants()'s cursor-passthrough contract,
  // not the route's actual page-size values.
  const parsed = new URL(url, 'http://localhost')
  const documentId = parsed.searchParams.get('documentId')
  const before = parsed.searchParams.get('before')
  const beforeId = parsed.searchParams.get('beforeId')
  const supersededIds = new Set(store.filter((r) => r.supersedesId).map((r) => r.supersedesId as string))
  const live = [...store]
    .filter((r) => r.documentId === documentId && !supersededIds.has(r.id))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  const windowed =
    before && beforeId
      ? live.filter((r) => {
          const rt = new Date(r.createdAt).getTime()
          const bt = new Date(before).getTime()
          return rt !== bt ? rt < bt : r.id < beforeId
        })
      : live
  const invariants = windowed.slice(0, MOCK_PAGE_SIZE)
  const last = invariants[invariants.length - 1]
  const hasMore = windowed.length > MOCK_PAGE_SIZE
  return Promise.resolve(
    jsonResponse({
      invariants,
      nextCursor: hasMore && last ? last.createdAt : null,
      nextCursorId: hasMore && last ? last.id : null,
      scanTruncated: false,
    }),
  )
}

beforeEach(() => {
  store = []
  nextId = 0
  failNextPost = false
  failNextResolve = false
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

describe('shouldCaptureInvariant', () => {
  // Regression for a review-caught bug: the capture checkbox/text in
  // SemanticCommitModal is derived from the PRIMARY change but is a
  // separate control from that row's own accept/reject toggle. Confirming
  // with the checkbox on must NOT capture the declared fact if the primary
  // edit itself was rejected — its claim never lands in the document, and
  // capturing it anyway would append a false, permanently unfixable
  // (append-only) ledger row with a real but misleading provenance hash.
  it('captures when the primary edit is among the accepted ids', () => {
    expect(shouldCaptureInvariant(['primary-1', 'cascade-2'], 'primary-1')).toBe(true)
  })

  it('does NOT capture when the primary edit was rejected, even if a cascade edit was accepted and applied', () => {
    expect(shouldCaptureInvariant(['cascade-2'], 'primary-1')).toBe(false)
  })

  it('does not capture when nothing was accepted', () => {
    expect(shouldCaptureInvariant([], 'primary-1')).toBe(false)
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

    const { invariants, nextCursor, nextCursorId, scanTruncated } = await listInvariants('doc-1')
    expect(invariants).toHaveLength(2)
    expect(invariants[0].statement).toBe('Termination notices go through HR.')
    expect(invariants[1].statement).toBe('Terminations are now 30 days.')
    expect(JSON.parse(invariants[1].blockIds)).toEqual(['blk-terminations'])
    expect(nextCursor).toBeNull()
    expect(nextCursorId).toBeNull()
    expect(scanTruncated).toBe(false)
  })

  it('excludes a resolved invariant\'s original row, keeping the resolution row live (#35)', async () => {
    const original = await captureInvariant({ documentId: 'doc-1', statement: 'Terminations are now 30 days.' })
    await resolveInvariant({ documentId: 'doc-1', invariantId: original.id, status: 'resolved' })

    const { invariants } = await listInvariants('doc-1')
    expect(invariants).toHaveLength(1)
    expect(invariants[0].status).toBe('resolved')
    expect(invariants[0].supersedesId).toBe(original.id)
  })

  it('fetches a second page via the returned cursor — the wrapper matches what the route (PR #57) can already do (#58)', async () => {
    // MOCK_PAGE_SIZE is 2, so 3 declared facts force a second page.
    await captureInvariant({ documentId: 'doc-1', statement: 'Fact one.' })
    await captureInvariant({ documentId: 'doc-1', statement: 'Fact two.' })
    await captureInvariant({ documentId: 'doc-1', statement: 'Fact three.' })

    const page1 = await listInvariants('doc-1')
    expect(page1.invariants).toHaveLength(2)
    expect(page1.invariants.map((i) => i.statement)).toEqual(['Fact three.', 'Fact two.'])
    expect(page1.nextCursor).not.toBeNull()
    expect(page1.nextCursorId).not.toBeNull()

    const page2 = await listInvariants('doc-1', {
      before: page1.nextCursor as string,
      beforeId: page1.nextCursorId as string,
    })
    expect(page2.invariants).toHaveLength(1)
    expect(page2.invariants[0].statement).toBe('Fact one.')
    // Second page is the remaining slice, not a repeat of page one.
    const page1Ids = new Set(page1.invariants.map((i) => i.id))
    expect(page1Ids.has(page2.invariants[0].id)).toBe(false)
    expect(page2.nextCursor).toBeNull()
    expect(page2.nextCursorId).toBeNull()
  })
})

describe('resolveInvariant', () => {
  it('appends a new row pointing supersedesId at the target, duplicating its content forward', async () => {
    const original = await captureInvariant({
      documentId: 'doc-1',
      statement: 'Terminations are now 30 days.',
      blockIds: ['blk-terminations'],
    })
    const resolved = await resolveInvariant({
      documentId: 'doc-1',
      invariantId: original.id,
      status: 'resolved',
    })
    expect(resolved.id).not.toBe(original.id)
    expect(resolved.supersedesId).toBe(original.id)
    expect(resolved.status).toBe('resolved')
    expect(resolved.statement).toBe(original.statement)
    expect(resolved.blockIds).toBe(original.blockIds)
  })

  it('throws on a failed resolve', async () => {
    const original = await captureInvariant({ documentId: 'doc-1', statement: 'A fact.' })
    failNextResolve = true
    await expect(
      resolveInvariant({ documentId: 'doc-1', invariantId: original.id, status: 'resolved' }),
    ).rejects.toThrow('boom')
  })
})
