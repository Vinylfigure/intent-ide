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
          status: 'active',
          provenanceCommitHash: data.provenanceCommitHash ?? null,
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
})
