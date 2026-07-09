import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  computeCommitHash,
  computeContentHash,
} from '@/lib/history/canonical'

// ---------------------------------------------------------------------------
// In-memory Prisma double for the DocCommit table. The route only uses
// findUnique / findFirst / findMany / create, so the double implements the
// exact query shapes route.ts issues.
// ---------------------------------------------------------------------------

interface Row {
  hash: string
  contentHash: string
  documentId: string
  parentHash: string | null
  kind: string
  message: string
  docJson: string
  blockIdsTouched: string
  annotationId: string | null
  auditIds: string
  actor: string
  modelVersion: string
  createdAt: Date
}

let rows: Row[] = []
let clock = 0
/** When true, the next create() simulates losing a race: a concurrent
 *  identical request lands first, so ours hits the unique constraint. */
let loseCreateRaceOnce = false
let lastFindManyArgs: any = null

function matches(row: Row, where: any): boolean {
  if (where.hash !== undefined && row.hash !== where.hash) return false
  if (where.documentId !== undefined && row.documentId !== where.documentId) return false
  if (where.parentHash !== undefined && row.parentHash !== where.parentHash) return false
  if (where.NOT?.hash !== undefined && row.hash === where.NOT.hash) return false
  if (where.createdAt?.lt !== undefined && !(row.createdAt < where.createdAt.lt)) return false
  return true
}

vi.mock('@/lib/db', () => ({
  prisma: {
    docCommit: {
      findUnique: async ({ where }: any) => rows.find((r) => r.hash === where.hash) ?? null,
      findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
      findMany: async (args: any) => {
        lastFindManyArgs = args
        return rows
          .filter((r) => matches(r, args.where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, args.take)
      },
      create: async ({ data }: any) => {
        const insert = (): Row => {
          const row: Row = {
            ...data,
            annotationId: data.annotationId ?? null,
            createdAt: new Date(1700000000000 + clock++ * 1000),
          }
          rows.push(row)
          return row
        }
        if (loseCreateRaceOnce) {
          loseCreateRaceOnce = false
          insert() // the concurrent identical request wins first…
          throw new Error('Unique constraint failed on the fields: (`hash`)')
        }
        if (rows.some((r) => r.hash === data.hash)) {
          throw new Error('Unique constraint failed on the fields: (`hash`)')
        }
        return insert()
      },
    },
  },
}))

// Import AFTER the mock so route.ts binds to the double.
import { GET, POST } from '../route'

beforeEach(() => {
  rows = []
  clock = 0
  loseCreateRaceOnce = false
  lastFindManyArgs = null
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function docJsonWithText(text: string) {
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })
}

interface BodyOverrides {
  documentId?: string
  parentHash?: string | null
  kind?: string
  message?: string
  actor?: string
  annotationId?: string | null
  auditIds?: string[]
  modelVersion?: string
}

/** A fully valid, correctly hashed commit body. */
async function validBody(docJson: string, over: BodyOverrides = {}) {
  const documentId = over.documentId ?? 'doc-1'
  const parentHash = over.parentHash ?? null
  const kind = over.kind ?? 'direct'
  const message = over.message ?? 'Edited document'
  const actor = over.actor ?? 'human'
  const annotationId = over.annotationId ?? null
  const auditIds = over.auditIds ?? []
  const modelVersion = over.modelVersion ?? ''
  const contentHash = await computeContentHash(docJson)
  const hash = await computeCommitHash({
    documentId,
    parentHash,
    contentHash,
    kind,
    message,
    actor,
    annotationId,
    auditIds,
    modelVersion,
  })
  return {
    action: 'commit',
    hash,
    contentHash,
    documentId,
    parentHash: parentHash ?? undefined,
    kind,
    message,
    docJson,
    blockIdsTouched: '[]',
    annotationId: annotationId ?? undefined,
    auditIds: JSON.stringify(auditIds),
    actor,
    modelVersion,
  }
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/history', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function getRequest(query: string) {
  return new NextRequest(`http://localhost/api/history?${query}`)
}

async function seedRoot(text = 'root') {
  const body = await validBody(docJsonWithText(text), { kind: 'import', message: 'Created' })
  const res = await POST(postRequest(body))
  expect(res.status).toBe(200)
  return body.hash
}

// ---------------------------------------------------------------------------
// POST — verification + linearity
// ---------------------------------------------------------------------------

describe('POST /api/history', () => {
  it('accepts a valid root commit and stores both hashes', async () => {
    const hash = await seedRoot()
    expect(rows).toHaveLength(1)
    expect(rows[0].hash).toBe(hash)
    expect(rows[0].contentHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('400s when the contentHash does not prove the content', async () => {
    const body = await validBody(docJsonWithText('a'))
    body.contentHash = await computeContentHash(docJsonWithText('tampered'))
    const res = await POST(postRequest(body))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Content hash mismatch/)
  })

  it('400s when the commit hash does not prove the attribution (tampered actor)', async () => {
    const body = await validBody(docJsonWithText('a'), { actor: 'human' })
    body.actor = 'ai+human' // provenance edit after hashing
    const res = await POST(postRequest(body))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Hash mismatch/)
  })

  it('409 stale-head: rejects a second root for the same document', async () => {
    await seedRoot('first root')
    const body = await validBody(docJsonWithText('second root'), {
      kind: 'import',
      message: 'Created again',
    })
    const res = await POST(postRequest(body))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ reason: 'stale-head' })
    expect(rows).toHaveLength(1)
  })

  it('409 stale-head: rejects a second child of the same parent (fork race)', async () => {
    const root = await seedRoot()
    const applyBody = await validBody(docJsonWithText('ai content'), {
      parentHash: root,
      kind: 'apply',
      actor: 'ai+human',
      message: 'AI change',
    })
    expect((await POST(postRequest(applyBody))).status).toBe(200)

    // A 'direct' autosave still parenting the stale head must NOT fork.
    const directBody = await validBody(docJsonWithText('typed content'), {
      parentHash: root,
      kind: 'direct',
    })
    const res = await POST(postRequest(directBody))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ reason: 'stale-head' })
    expect(rows).toHaveLength(2)
  })

  it('200s an identical duplicate POST (idempotent re-send)', async () => {
    const body = await validBody(docJsonWithText('a'), { kind: 'import', message: 'Created' })
    expect((await POST(postRequest(body))).status).toBe(200)
    const res = await POST(postRequest(body))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ hash: body.hash, existing: true })
    expect(rows).toHaveLength(1)
  })

  it('200s when two concurrent identical POSTs race into the unique constraint', async () => {
    const body = await validBody(docJsonWithText('a'), { kind: 'import', message: 'Created' })
    loseCreateRaceOnce = true // our create hits the PK collision
    const res = await POST(postRequest(body))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ hash: body.hash, existing: true })
    expect(rows).toHaveLength(1)
  })

  it('400s an unknown parent', async () => {
    await seedRoot()
    const body = await validBody(docJsonWithText('b'), { parentHash: 'nope'.repeat(16) })
    const res = await POST(postRequest(body))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/parentHash/)
  })
})

// ---------------------------------------------------------------------------
// GET — limit sanitization + before cursor
// ---------------------------------------------------------------------------

describe('GET /api/history', () => {
  async function seedChain(texts: string[]) {
    let parent: string | null = null
    for (const text of texts) {
      const body = await validBody(docJsonWithText(text), {
        parentHash: parent,
        kind: parent ? 'direct' : 'import',
        message: text,
      })
      const res = await POST(postRequest(body))
      expect(res.status).toBe(200)
      parent = body.hash
    }
  }

  it('sanitizes a NaN limit to the default instead of passing take:NaN to Prisma', async () => {
    await seedChain(['a', 'b'])
    const res = await GET(getRequest('documentId=doc-1&limit=abc'))
    expect(res.status).toBe(200)
    expect(lastFindManyArgs.take).toBe(100)
    expect((await res.json()).commits).toHaveLength(2)
  })

  it('clamps negative and oversized limits into 1..200', async () => {
    await seedChain(['a', 'b', 'c'])
    await GET(getRequest('documentId=doc-1&limit=-5'))
    expect(lastFindManyArgs.take).toBe(1)
    await GET(getRequest('documentId=doc-1&limit=99999'))
    expect(lastFindManyArgs.take).toBe(200)
  })

  it('pages past the first batch with the ?before cursor', async () => {
    await seedChain(['a', 'b', 'c'])
    const first = await GET(getRequest('documentId=doc-1&limit=2'))
    const page1 = (await first.json()).commits
    expect(page1).toHaveLength(2)
    expect(page1.map((c: any) => c.message)).toEqual(['c', 'b'])

    const cursor = encodeURIComponent(new Date(page1[1].createdAt).toISOString())
    const second = await GET(getRequest(`documentId=doc-1&limit=2&before=${cursor}`))
    const page2 = (await second.json()).commits
    expect(page2.map((c: any) => c.message)).toEqual(['a'])
  })

  it('ignores an invalid before cursor', async () => {
    await seedChain(['a', 'b'])
    const res = await GET(getRequest('documentId=doc-1&before=not-a-date'))
    expect((await res.json()).commits).toHaveLength(2)
  })
})
