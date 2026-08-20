import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// In-memory Prisma double for the DocInvariant table. The resolve route uses
// findUnique / findFirst / create, so the double implements exactly those.
// ---------------------------------------------------------------------------

interface Row {
  id: string
  documentId: string
  statement: string
  blockIds: string
  checkKind: string
  status: string
  provenanceCommitHash: string | null
  supersedesId: string | null
  createdAt: Date
}

let rows: Row[] = []
let clock = 0
let nextId = 0

function seedRow(overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: `inv-${nextId++}`,
    documentId: 'doc-1',
    statement: 'Terminations are now 30 days.',
    blockIds: JSON.stringify(['blk-terminations']),
    checkKind: 'deterministic',
    status: 'active',
    provenanceCommitHash: 'hash-1',
    supersedesId: null,
    createdAt: new Date(1700000000000 + clock++ * 1000),
    ...overrides,
  }
  rows.push(row)
  return row
}

// Simulates the real schema's `supersedesId String? @unique` — SQLite
// unique indexes allow unlimited NULLs, so only a non-null collision throws.
let forceRaceOnNextCreate = false

vi.mock('@/lib/db', () => ({
  prisma: {
    docInvariant: {
      findUnique: async ({ where }: any) => {
        if (where.id !== undefined) return rows.find((r) => r.id === where.id) ?? null
        if (where.supersedesId !== undefined) {
          return rows.find((r) => r.supersedesId === where.supersedesId) ?? null
        }
        return null
      },
      create: async ({ data }: any) => {
        // A concurrent request's write landing between this route's own
        // pre-check and its create — the unique-constraint race #35's review
        // flagged. Simulated explicitly rather than via true concurrency
        // since the double is single-threaded.
        if (forceRaceOnNextCreate && data.supersedesId != null) {
          forceRaceOnNextCreate = false
          rows.push({
            id: `inv-${nextId++}`,
            documentId: data.documentId,
            statement: data.statement,
            blockIds: data.blockIds,
            checkKind: data.checkKind,
            status: data.status,
            provenanceCommitHash: data.provenanceCommitHash ?? null,
            supersedesId: data.supersedesId,
            createdAt: new Date(1700000000000 + clock++ * 1000),
          })
          throw new Error('UNIQUE constraint failed: DocInvariant.supersedesId')
        }
        if (data.supersedesId != null && rows.some((r) => r.supersedesId === data.supersedesId)) {
          throw new Error('UNIQUE constraint failed: DocInvariant.supersedesId')
        }
        const row: Row = {
          id: `inv-${nextId++}`,
          documentId: data.documentId,
          statement: data.statement,
          blockIds: data.blockIds,
          checkKind: data.checkKind,
          status: data.status,
          provenanceCommitHash: data.provenanceCommitHash ?? null,
          supersedesId: data.supersedesId ?? null,
          createdAt: new Date(1700000000000 + clock++ * 1000),
        }
        rows.push(row)
        return row
      },
    },
  },
}))

// Import AFTER the mock so route.ts binds to the double.
import { POST } from '../route'

beforeEach(() => {
  rows = []
  clock = 0
  nextId = 0
  forceRaceOnNextCreate = false
})

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/invariants/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/invariants/resolve', () => {
  it('appends a new row pointing supersedesId at the target, duplicating its content forward', async () => {
    const original = seedRow()

    const res = await POST(postRequest({ documentId: 'doc-1', invariantId: original.id, status: 'resolved' }))
    expect(res.status).toBe(200)
    const data = await res.json()

    expect(data.invariant.id).not.toBe(original.id)
    expect(data.invariant.supersedesId).toBe(original.id)
    expect(data.invariant.status).toBe('resolved')
    expect(data.invariant.statement).toBe(original.statement)
    expect(data.invariant.blockIds).toBe(original.blockIds)
    expect(data.invariant.provenanceCommitHash).toBe(original.provenanceCommitHash)

    // The original row's own columns are never written to — append-only.
    const stillOriginal = rows.find((r) => r.id === original.id)
    expect(stillOriginal?.status).toBe('active')
    expect(stillOriginal?.supersedesId).toBeNull()
    expect(rows).toHaveLength(2)
  })

  it('accepts a "superseded" status transition too', async () => {
    const original = seedRow()
    const res = await POST(postRequest({ documentId: 'doc-1', invariantId: original.id, status: 'superseded' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.invariant.status).toBe('superseded')
  })

  it('rejects a missing documentId or invariantId', async () => {
    const res1 = await POST(postRequest({ invariantId: 'inv-0', status: 'resolved' }))
    expect(res1.status).toBe(400)
    const res2 = await POST(postRequest({ documentId: 'doc-1', status: 'resolved' }))
    expect(res2.status).toBe(400)
    expect(rows).toHaveLength(0)
  })

  it('rejects an invalid status', async () => {
    const original = seedRow()
    const res = await POST(postRequest({ documentId: 'doc-1', invariantId: original.id, status: 'active' }))
    expect(res.status).toBe(400)
    expect(rows).toHaveLength(1)
  })

  it('404s on an unknown invariantId', async () => {
    const res = await POST(postRequest({ documentId: 'doc-1', invariantId: 'nope', status: 'resolved' }))
    expect(res.status).toBe(404)
  })

  it("404s when documentId doesn't match the target row's own documentId", async () => {
    const original = seedRow({ documentId: 'doc-1' })
    const res = await POST(postRequest({ documentId: 'doc-2', invariantId: original.id, status: 'resolved' }))
    expect(res.status).toBe(404)
  })

  it('409s when the target has already been resolved/superseded', async () => {
    const original = seedRow()
    const first = await POST(postRequest({ documentId: 'doc-1', invariantId: original.id, status: 'resolved' }))
    expect(first.status).toBe(200)

    const second = await POST(postRequest({ documentId: 'doc-1', invariantId: original.id, status: 'resolved' }))
    expect(second.status).toBe(409)
    expect(rows).toHaveLength(2)
  })

  it('409s (never 500, never a duplicate row) when a concurrent request wins the race past the pre-check', async () => {
    // Regression for the #35 review's HIGH finding: two requests can both
    // pass the findUnique pre-check before either writes. The double injects
    // a competing write INSIDE this request's own create() call, simulating
    // the other request landing in the gap, and the real route's unique-
    // constraint catch-and-requery must turn that into a clean 409.
    const original = seedRow()
    forceRaceOnNextCreate = true

    const res = await POST(postRequest({ documentId: 'doc-1', invariantId: original.id, status: 'resolved' }))
    expect(res.status).toBe(409)
    // Exactly the one row the "concurrent" write inserted — this request's
    // own create() threw and produced nothing.
    expect(rows.filter((r) => r.supersedesId === original.id)).toHaveLength(1)
  })

  it('supports a second-level resolve — resolving a resolution row itself', async () => {
    const original = seedRow()
    const firstResolve = await POST(
      postRequest({ documentId: 'doc-1', invariantId: original.id, status: 'resolved' }),
    )
    const firstData = (await firstResolve.json()).invariant

    const secondResolve = await POST(
      postRequest({ documentId: 'doc-1', invariantId: firstData.id, status: 'superseded' }),
    )
    expect(secondResolve.status).toBe(200)
    const secondData = (await secondResolve.json()).invariant

    expect(secondData.supersedesId).toBe(firstData.id)
    expect(secondData.status).toBe('superseded')
    // The whole chain exists, untouched: original -> firstResolve -> secondResolve.
    expect(rows).toHaveLength(3)
    expect(rows.find((r) => r.id === original.id)?.status).toBe('active')
    expect(rows.find((r) => r.id === firstData.id)?.status).toBe('resolved')
  })

  it('exposes no PATCH/PUT/DELETE — status transitions are append-only writes', async () => {
    const routeModule: Record<string, unknown> = await import('../route')
    expect(routeModule.PATCH).toBeUndefined()
    expect(routeModule.PUT).toBeUndefined()
    expect(routeModule.DELETE).toBeUndefined()
  })
})
