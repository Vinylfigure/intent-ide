import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  computeCommitHash,
  computeContentHash,
} from '@/lib/history/canonical'

// ---------------------------------------------------------------------------
// In-memory Prisma double for the DocCommit table. The route uses
// findUnique / findFirst / findMany / create / delete / $transaction, so the
// double implements the exact query shapes route.ts issues.
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

/** Shared by the top-level client and the `$transaction` tx client below. */
function performCreate({ data }: any): Row {
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
}

function performDelete({ where }: any): Row {
  const idx = rows.findIndex((r) => r.hash === where.hash)
  if (idx === -1) throw new Error('Record to delete does not exist.')
  const [removed] = rows.splice(idx, 1)
  return removed
}

/**
 * A real (macrotask) tick, not just a microtask — wide enough that two
 * concurrent requests' DB calls reliably interleave regardless of how fast
 * an unrelated real async op (e.g. WebCrypto hashing) happens to resolve in
 * this environment. Without this, a race test can pass "by accident": both
 * requests' non-transactional reads might happen to run back-to-back before
 * either write lands, hiding a real TOCTOU gap instead of exercising it.
 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Function declaration (not `const`) so it is safe to reference from inside
 * the `vi.mock` factory below regardless of Vitest's hoisting of that call —
 * function declarations are fully hoisted with their body, unlike `const`.
 */
function makeDocCommitClient() {
  return {
    findUnique: async ({ where }: any) => {
      await tick()
      return rows.find((r) => r.hash === where.hash) ?? null
    },
    findFirst: async ({ where }: any) => {
      await tick()
      return rows.find((r) => matches(r, where)) ?? null
    },
    findMany: async (args: any) => {
      await tick()
      lastFindManyArgs = args
      return rows
        .filter((r) => matches(r, args.where))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, args.take)
    },
    create: async (args: any) => {
      await tick()
      return performCreate(args)
    },
    delete: async (args: any) => {
      await tick()
      return performDelete(args)
    },
  }
}

/**
 * Serializes concurrent `$transaction` callbacks so at most one runs at a
 * time, start to finish — the same atomicity guarantee real Prisma gets from
 * SQLite. Without this, two callbacks invoked via `Promise.all` could
 * interleave their internal `await`s (e.g. both read the target row before
 * either deletes it), which a real DB transaction would never allow and
 * which would make a concurrency test non-representative of production.
 */
let txQueue: Promise<unknown> = Promise.resolve()
function runTransaction(fn: (tx: unknown) => Promise<unknown>) {
  const run = txQueue.then(() => fn({ docCommit: makeDocCommitClient() }))
  txQueue = run.catch(() => undefined)
  return run
}

vi.mock('@/lib/db', () => ({
  prisma: {
    docCommit: makeDocCommitClient(),
    $transaction: (fn: any) => runTransaction(fn),
  },
}))

// Import AFTER the mock so route.ts binds to the double.
import { GET, POST } from '../route'

beforeEach(() => {
  rows = []
  clock = 0
  loseCreateRaceOnce = false
  lastFindManyArgs = null
  txQueue = Promise.resolve()
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

interface AmendOverrides {
  documentId?: string
  message?: string
  actor?: string
  annotationId?: string | null
  auditIds?: string[]
  modelVersion?: string
}

/**
 * A fully valid, correctly hashed amend body targeting `target` (a stored
 * row's metadata) — the new commit's parentHash is the TARGET's own parent,
 * not the target's hash, matching the "step into the target's slot" contract.
 */
async function validAmendBody(target: Row, docJson: string, over: AmendOverrides = {}) {
  const documentId = over.documentId ?? target.documentId
  const parentHash = target.parentHash
  const kind = 'direct'
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
    action: 'amend',
    targetHash: target.hash,
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
// POST /api/history — action: 'amend' (retention-only 'direct' collapse)
// ---------------------------------------------------------------------------

describe("POST /api/history — action: 'amend'", () => {
  it("replaces a 'direct' head in place: same row count, new content, parent unchanged", async () => {
    const root = await seedRoot()
    const directBody = await validBody(docJsonWithText('v1'), { parentHash: root })
    expect((await POST(postRequest(directBody))).status).toBe(200)
    expect(rows).toHaveLength(2)

    const target = rows[1]
    const amendBody = await validAmendBody(target, docJsonWithText('v2'))
    const res = await POST(postRequest(amendBody))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ hash: amendBody.hash })

    expect(rows).toHaveLength(2) // no growth — the direct row was replaced
    expect(rows.find((r) => r.hash === target.hash)).toBeUndefined()
    const survivor = rows.find((r) => r.hash === amendBody.hash)!
    expect(survivor.parentHash).toBe(root) // steps into the target's slot
    expect(survivor.kind).toBe('direct')
    expect(JSON.parse(survivor.docJson)).toMatchObject({
      content: [{ content: [{ text: 'v2' }] }],
    })
  })

  it('collapses a long run of amends into a single row', async () => {
    const root = await seedRoot()
    const firstDirect = await validBody(docJsonWithText('v1'), { parentHash: root })
    expect((await POST(postRequest(firstDirect))).status).toBe(200)

    let target = rows.find((r) => r.hash === firstDirect.hash)!
    for (let i = 2; i <= 5; i++) {
      const amendBody = await validAmendBody(target, docJsonWithText(`v${i}`))
      const res = await POST(postRequest(amendBody))
      expect(res.status).toBe(200)
      target = rows.find((r) => r.hash === amendBody.hash)!
    }
    expect(rows).toHaveLength(2) // root + one surviving direct row, no matter how many amends
    expect(rows[1].parentHash).toBe(root)
  })

  it('400s when kind is not direct — apply/import/restore can never be amend targets', async () => {
    const root = await seedRoot()
    const applyBody = await validBody(docJsonWithText('applied'), {
      parentHash: root,
      kind: 'apply',
      actor: 'ai+human',
    })
    expect((await POST(postRequest(applyBody))).status).toBe(200)

    const target = rows[1]
    const amendBody = await validAmendBody(target, docJsonWithText('tampered'))
    ;(amendBody as any).kind = 'apply' // attempt to smuggle a compliance-relevant kind through amend
    const res = await POST(postRequest(amendBody))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/direct/)
    expect(rows).toHaveLength(2) // untouched
  })

  it('400s when the amend target itself is not a direct commit', async () => {
    const root = await seedRoot()
    const applyBody = await validBody(docJsonWithText('applied'), {
      parentHash: root,
      kind: 'apply',
      actor: 'ai+human',
    })
    expect((await POST(postRequest(applyBody))).status).toBe(200)

    const target = rows[1] // the 'apply' row
    const amendBody = await validAmendBody(target, docJsonWithText('tampered'))
    const res = await POST(postRequest(amendBody))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/not a direct commit/)
    expect(rows).toHaveLength(2) // the 'apply' row survives untouched
    expect(rows.find((r) => r.hash === target.hash)).toBeDefined()
  })

  it('409 stale-head when the amend target already has a child', async () => {
    const root = await seedRoot()
    const directBody = await validBody(docJsonWithText('v1'), { parentHash: root })
    expect((await POST(postRequest(directBody))).status).toBe(200)
    const target = rows[1]

    // A second writer already chained a new 'apply' onto this direct row.
    const applyBody = await validBody(docJsonWithText('v2'), {
      parentHash: target.hash,
      kind: 'apply',
      actor: 'ai+human',
    })
    expect((await POST(postRequest(applyBody))).status).toBe(200)

    // Our amend, computed against the now-stale target, must be rejected —
    // deleting `target` here would orphan the 'apply' row's parentHash.
    const amendBody = await validAmendBody(target, docJsonWithText('mine'))
    const res = await POST(postRequest(amendBody))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ reason: 'stale-head' })
    expect(rows).toHaveLength(3) // nothing deleted
    expect(rows.find((r) => r.hash === target.hash)).toBeDefined()
  })

  it('409 stale-head when the amend target no longer exists', async () => {
    const root = await seedRoot()
    const directBody = await validBody(docJsonWithText('v1'), { parentHash: root })
    expect((await POST(postRequest(directBody))).status).toBe(200)
    const target = rows[1]

    const amendBody = await validAmendBody(target, docJsonWithText('mine'))
    ;(amendBody as any).targetHash = 'nonexistent'.repeat(8)
    const res = await POST(postRequest(amendBody))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ reason: 'stale-head' })
  })

  it('200s an identical duplicate amend (idempotent re-send)', async () => {
    const root = await seedRoot()
    const directBody = await validBody(docJsonWithText('v1'), { parentHash: root })
    expect((await POST(postRequest(directBody))).status).toBe(200)
    const target = rows[1]

    const amendBody = await validAmendBody(target, docJsonWithText('v2'))
    expect((await POST(postRequest(amendBody))).status).toBe(200)
    const res = await POST(postRequest(amendBody))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ hash: amendBody.hash, existing: true })
    expect(rows).toHaveLength(2)
  })

  it('two concurrent amends of the SAME target: one wins 200, the other gets 409 stale-head (never a 500)', async () => {
    const root = await seedRoot()
    const directBody = await validBody(docJsonWithText('v1'), { parentHash: root })
    expect((await POST(postRequest(directBody))).status).toBe(200)
    const target = rows[1]

    // Two independent writers (e.g. two tabs) both amending the same head at
    // once. Before the fix, the second request's transaction would find the
    // target already deleted by the first and throw an uncaught "record to
    // delete does not exist" — an unhandled 500 instead of the documented
    // 409 the client's retry logic knows how to recover from.
    const amendA = await validAmendBody(target, docJsonWithText('from tab A'))
    const amendB = await validAmendBody(target, docJsonWithText('from tab B'))
    const [resA, resB] = await Promise.all([
      POST(postRequest(amendA)),
      POST(postRequest(amendB)),
    ])

    const statuses = [resA.status, resB.status].sort()
    expect(statuses).toEqual([200, 409])
    const [winner, loser] = resA.status === 200 ? [resA, resB] : [resB, resA]
    expect(await loser.json()).toMatchObject({ reason: 'stale-head' })
    const winnerBody = await winner.json()

    // Exactly one row replaced the target — no orphan, no duplicate, no
    // partially-applied delete-without-create (or vice versa).
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.hash === target.hash)).toBeUndefined()
    expect(rows.find((r) => r.hash === winnerBody.hash)).toBeDefined()
  })

  it("400s when a self-consistent payload's parentHash does not match the target's own parent", async () => {
    const root = await seedRoot()
    const directBody = await validBody(docJsonWithText('v1'), { parentHash: root })
    expect((await POST(postRequest(directBody))).status).toBe(200)
    const target = rows[1]

    // Self-consistent but wrong: the hash is computed against `target.hash`
    // as the parent (an append-style parent) even though this is an amend,
    // whose parent must be the TARGET's OWN parent. Hash verification alone
    // cannot catch this — it only proves the payload is internally
    // consistent — so this exercises the dedicated target-consistency check.
    const docJson = docJsonWithText('v2')
    const contentHash = await computeContentHash(docJson)
    const wrongParentHash = target.hash
    const hash = await computeCommitHash({
      documentId: target.documentId,
      parentHash: wrongParentHash,
      contentHash,
      kind: 'direct',
      message: 'Edited document',
      actor: 'human',
      annotationId: null,
      auditIds: [],
      modelVersion: '',
    })
    const amendBody = {
      action: 'amend',
      targetHash: target.hash,
      hash,
      contentHash,
      documentId: target.documentId,
      parentHash: wrongParentHash,
      kind: 'direct',
      message: 'Edited document',
      docJson,
      blockIdsTouched: '[]',
      auditIds: '[]',
      actor: 'human',
      modelVersion: '',
    }
    const res = await POST(postRequest(amendBody))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/parent/)
    expect(rows).toHaveLength(2) // untouched
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

// ── Production gate ───────────────────────────────────────────────────────────
// History stores full document snapshots server-side with no auth, so the
// public deployment keeps it off unless the operator opts in (HISTORY_ENABLED).

describe('/api/history — production gate', () => {
  it('returns 403 for GET and POST in production without HISTORY_ENABLED', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      expect((await GET(getRequest('documentId=doc-1'))).status).toBe(403)
      expect((await POST(postRequest({ action: 'commit' }))).status).toBe(403)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('stays enabled in production when HISTORY_ENABLED=1', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('HISTORY_ENABLED', '1')
    try {
      await seedRoot()
      const res = await GET(getRequest('documentId=doc-1'))
      expect(res.status).toBe(200)
      expect((await res.json()).commits).toHaveLength(1)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
