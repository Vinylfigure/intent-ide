import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// In-memory Prisma double for the DocInvariant table. The route only uses
// findMany / create, so the double implements exactly those query shapes.
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

vi.mock('@/lib/db', () => ({
  prisma: {
    docInvariant: {
      findMany: async (args: any) => {
        return rows
          .filter((r) => (args.where?.documentId ? r.documentId === args.where.documentId : true))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, args.take)
      },
      create: async ({ data }: any) => {
        const row: Row = {
          id: `inv-${nextId++}`,
          documentId: data.documentId,
          statement: data.statement,
          blockIds: data.blockIds,
          checkKind: data.checkKind,
          status: data.status ?? 'active',
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
import { GET, POST } from '../route'

beforeEach(() => {
  rows = []
  clock = 0
  nextId = 0
})

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/invariants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function getRequest(query: string) {
  return new NextRequest(`http://localhost/api/invariants?${query}`)
}

describe('POST /api/invariants', () => {
  it('captures a declared fact linked to its block evidence — the founder fixture', async () => {
    const res = await POST(
      postRequest({
        documentId: 'doc-1',
        statement: 'Terminations are now 30 days.',
        blockIds: ['blk-terminations'],
        provenanceCommitHash: 'commit-abc',
      }),
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.invariant.statement).toBe('Terminations are now 30 days.')
    expect(JSON.parse(data.invariant.blockIds)).toEqual(['blk-terminations'])
    expect(data.invariant.checkKind).toBe('deterministic')
    expect(data.invariant.status).toBe('active')
    expect(data.invariant.provenanceCommitHash).toBe('commit-abc')
    expect(rows).toHaveLength(1)
  })

  it('defaults blockIds to [] and checkKind to deterministic when omitted', async () => {
    const res = await POST(postRequest({ documentId: 'doc-1', statement: 'A fact.' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(JSON.parse(data.invariant.blockIds)).toEqual([])
    expect(data.invariant.checkKind).toBe('deterministic')
    expect(data.invariant.provenanceCommitHash).toBeNull()
  })

  it('rejects a missing documentId or statement', async () => {
    const res1 = await POST(postRequest({ statement: 'A fact.' }))
    expect(res1.status).toBe(400)
    const res2 = await POST(postRequest({ documentId: 'doc-1', statement: '' }))
    expect(res2.status).toBe(400)
    expect(rows).toHaveLength(0)
  })

  it('rejects an oversize statement', async () => {
    const res = await POST(
      postRequest({ documentId: 'doc-1', statement: 'x'.repeat(2001) }),
    )
    expect(res.status).toBe(400)
    expect(rows).toHaveLength(0)
  })

  it('rejects a non-string-array blockIds', async () => {
    const res = await POST(
      postRequest({ documentId: 'doc-1', statement: 'A fact.', blockIds: [1, 2] }),
    )
    expect(res.status).toBe(400)
    expect(rows).toHaveLength(0)
  })

  it('rejects an unknown checkKind', async () => {
    const res = await POST(
      postRequest({ documentId: 'doc-1', statement: 'A fact.', checkKind: 'vibes' }),
    )
    expect(res.status).toBe(400)
    expect(rows).toHaveLength(0)
  })

  it('never updates or deletes — every capture is a new append-only row', async () => {
    await POST(postRequest({ documentId: 'doc-1', statement: 'Terminations are 30 days.' }))
    await POST(postRequest({ documentId: 'doc-1', statement: 'Terminations are 45 days.' }))
    expect(rows).toHaveLength(2)
    expect(rows[0].statement).toBe('Terminations are 30 days.')
    expect(rows[1].statement).toBe('Terminations are 45 days.')
    // The route module exposes no PATCH/DELETE handler at all.
    const routeModule: Record<string, unknown> = await import('../route')
    expect(routeModule.PATCH).toBeUndefined()
    expect(routeModule.DELETE).toBeUndefined()
    expect(routeModule.PUT).toBeUndefined()
  })
})

describe('GET /api/invariants', () => {
  it('requires a documentId', async () => {
    const res = await GET(getRequest(''))
    expect(res.status).toBe(400)
  })

  it('round-trips a captured fact, newest first, scoped to its document', async () => {
    await POST(
      postRequest({
        documentId: 'doc-1',
        statement: 'Terminations are now 30 days.',
        blockIds: ['blk-terminations'],
      }),
    )
    await POST(postRequest({ documentId: 'doc-2', statement: 'Unrelated fact.' }))
    await POST(
      postRequest({
        documentId: 'doc-1',
        statement: 'Termination notices go through HR.',
        blockIds: ['blk-hr'],
      }),
    )

    const res = await GET(getRequest('documentId=doc-1'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.invariants).toHaveLength(2)
    // Newest first.
    expect(data.invariants[0].statement).toBe('Termination notices go through HR.')
    expect(JSON.parse(data.invariants[0].blockIds)).toEqual(['blk-hr'])
    expect(data.invariants[1].statement).toBe('Terminations are now 30 days.')
    expect(JSON.parse(data.invariants[1].blockIds)).toEqual(['blk-terminations'])
  })

  it('caps and sanitizes the limit param', async () => {
    for (let i = 0; i < 5; i++) {
      await POST(postRequest({ documentId: 'doc-1', statement: `fact ${i}` }))
    }
    const res = await GET(getRequest('documentId=doc-1&limit=2'))
    const data = await res.json()
    expect(data.invariants).toHaveLength(2)
  })

  it('excludes a superseded row, keeping the row that supersedes it (#35 resolve/dismiss)', async () => {
    const created = await POST(postRequest({ documentId: 'doc-1', statement: 'Terminations are now 30 days.' }))
    const original = (await created.json()).invariant

    // Simulates what POST /api/invariants/resolve creates — a new row
    // duplicating the target's content forward with supersedesId set, never
    // mutating the original row's own columns.
    rows.push({
      id: `inv-${nextId++}`,
      documentId: 'doc-1',
      statement: original.statement,
      blockIds: original.blockIds,
      checkKind: original.checkKind,
      status: 'resolved',
      provenanceCommitHash: original.provenanceCommitHash,
      supersedesId: original.id,
      createdAt: new Date(1700000000000 + clock++ * 1000),
    })

    const res = await GET(getRequest('documentId=doc-1'))
    const data = await res.json()
    expect(data.invariants).toHaveLength(1)
    expect(data.invariants[0].status).toBe('resolved')
    expect(data.invariants[0].supersedesId).toBe(original.id)
    // The original row itself is untouched (still exists, still 'active') —
    // it just no longer appears in the LIVE set GET returns.
    expect(rows.find((r) => r.id === original.id)?.status).toBe('active')
  })

  it('pages past MAX_LIMIT via the before cursor, returning the next slice (not a repeat of page one)', async () => {
    const MAX_LIMIT = 200
    const total = MAX_LIMIT + 40
    for (let i = 0; i < total; i++) {
      await POST(postRequest({ documentId: 'doc-1', statement: `fact ${i}` }))
    }

    const page1Res = await GET(getRequest('documentId=doc-1&limit=200'))
    const page1 = await page1Res.json()
    expect(page1.invariants).toHaveLength(200)
    // Newest-first: page one holds facts total-1 .. 40.
    expect(page1.invariants[0].statement).toBe(`fact ${total - 1}`)
    expect(page1.invariants[199].statement).toBe(`fact ${total - 200}`)
    expect(page1.nextCursor).toBeTruthy()

    const page2Res = await GET(
      getRequest(`documentId=doc-1&limit=200&before=${encodeURIComponent(page1.nextCursor)}`),
    )
    const page2 = await page2Res.json()
    expect(page2.invariants).toHaveLength(40)
    // Page two continues where page one left off — no overlap with page one.
    expect(page2.invariants[0].statement).toBe(`fact ${total - 201}`)
    expect(page2.invariants[39].statement).toBe('fact 0')
    const page1Ids = new Set(page1.invariants.map((inv: { id: string }) => inv.id))
    for (const inv of page2.invariants) {
      expect(page1Ids.has(inv.id)).toBe(false)
    }
    // The live set is exhausted — no further page.
    expect(page2.nextCursor).toBeNull()
  })

  it('before cursor still respects the supersede chain across the page boundary', async () => {
    // Seed enough rows that the superseded original and its resolve row can
    // land on different pages, then verify the original never reappears.
    const created = await POST(
      postRequest({ documentId: 'doc-1', statement: 'Terminations are now 30 days.' }),
    )
    const original = (await created.json()).invariant
    for (let i = 0; i < 5; i++) {
      await POST(postRequest({ documentId: 'doc-1', statement: `filler ${i}` }))
    }
    // The resolve row is newest, so it lands on page one; the original it
    // supersedes is oldest, so it would land on page two if not excluded.
    rows.push({
      id: `inv-${nextId++}`,
      documentId: 'doc-1',
      statement: original.statement,
      blockIds: original.blockIds,
      checkKind: original.checkKind,
      status: 'resolved',
      provenanceCommitHash: original.provenanceCommitHash,
      supersedesId: original.id,
      createdAt: new Date(1700000000000 + clock++ * 1000),
    })

    const page1Res = await GET(getRequest('documentId=doc-1&limit=3'))
    const page1 = await page1Res.json()
    expect(page1.invariants).toHaveLength(3)
    expect(page1.nextCursor).toBeTruthy()

    const page2Res = await GET(
      getRequest(`documentId=doc-1&limit=3&before=${encodeURIComponent(page1.nextCursor)}`),
    )
    const page2 = await page2Res.json()
    // 7 rows created (1 original + 5 filler + 1 resolve), minus the
    // superseded original = 6 live rows; page one took 3, page two the rest.
    expect(page2.invariants).toHaveLength(3)
    expect(page2.invariants.some((inv: { id: string }) => inv.id === original.id)).toBe(false)
  })

  it('follows a two-level supersede chain, surfacing only the newest terminal row', async () => {
    const created = await POST(postRequest({ documentId: 'doc-1', statement: 'Terminations are now 30 days.' }))
    const original = (await created.json()).invariant

    const firstResolveId = `inv-${nextId++}`
    rows.push({
      id: firstResolveId,
      documentId: 'doc-1',
      statement: original.statement,
      blockIds: original.blockIds,
      checkKind: original.checkKind,
      status: 'resolved',
      provenanceCommitHash: original.provenanceCommitHash,
      supersedesId: original.id,
      createdAt: new Date(1700000000000 + clock++ * 1000),
    })
    // A resolve-of-a-resolve — e.g. a newly declared fact later supersedes
    // the ledger's record of having resolved the earlier one.
    rows.push({
      id: `inv-${nextId++}`,
      documentId: 'doc-1',
      statement: original.statement,
      blockIds: original.blockIds,
      checkKind: original.checkKind,
      status: 'superseded',
      provenanceCommitHash: original.provenanceCommitHash,
      supersedesId: firstResolveId,
      createdAt: new Date(1700000000000 + clock++ * 1000),
    })

    const res = await GET(getRequest('documentId=doc-1'))
    const data = await res.json()
    expect(data.invariants).toHaveLength(1)
    expect(data.invariants[0].status).toBe('superseded')
    expect(data.invariants[0].supersedesId).toBe(firstResolveId)
  })
})
