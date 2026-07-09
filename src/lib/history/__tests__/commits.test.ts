import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { Node } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import { schema } from '@/lib/prosemirror/schema'
import { computeCommitHash, computeContentHash } from '../canonical'
import {
  blameBlock,
  createCommit,
  getCommit,
  headCommit,
  listCommits,
  restoreCommit,
  type CommitMeta,
} from '../commits'

// ---------------------------------------------------------------------------
// In-memory append-only fake of /api/history (+ /api/audit), mirroring the
// route's contract: two-level hash verification, idempotent duplicates,
// linearity (one root, one child per parent → 409 stale-head). Follows the
// fetch-stub precedent from documentStore.phase8.test.ts.
// ---------------------------------------------------------------------------

interface StoredCommit {
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
  createdAt: string
}

let commits: StoredCommit[] = []
let auditCalls: any[] = []
let requestLog: { url: string; method: string }[] = []
let clock = 0
/** How many incoming POSTs should first be beaten by a concurrent writer. */
let raceInjectionsRemaining = 0
/** When set, POSTs of this kind fail with HTTP 500 (server outage simulation). */
let failPostForKind: string | null = null

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  }
}

function meta({ docJson: _docJson, ...rest }: StoredCommit) {
  return rest
}

function serverHead(documentId: string): StoredCommit | null {
  return (
    [...commits]
      .filter((c) => c.documentId === documentId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ??
    null
  )
}

/** Server-side helper: append a fully valid commit (simulates another writer winning). */
async function pushServerCommit(documentId: string, docJson: unknown, message = 'concurrent writer') {
  const head = serverHead(documentId)
  const docJsonString = typeof docJson === 'string' ? docJson : JSON.stringify(docJson)
  const contentHash = await computeContentHash(docJsonString)
  const hash = await computeCommitHash({
    documentId,
    parentHash: head?.hash ?? null,
    contentHash,
    kind: 'direct',
    message,
    actor: 'human',
    annotationId: null,
    auditIds: [],
    modelVersion: '',
  })
  commits.push({
    hash,
    contentHash,
    documentId,
    parentHash: head?.hash ?? null,
    kind: 'direct',
    message,
    docJson: docJsonString,
    blockIdsTouched: '[]',
    annotationId: null,
    auditIds: '[]',
    actor: 'human',
    modelVersion: '',
    createdAt: new Date(1700000000000 + clock++ * 1000).toISOString(),
  })
  return hash
}

async function fakeFetch(input: string, init?: { method?: string; body?: string }) {
  const url = String(input)
  const method = init?.method ?? 'GET'
  requestLog.push({ url, method })

  if (url.startsWith('/api/audit')) {
    auditCalls.push(JSON.parse(init?.body ?? '{}'))
    return jsonResponse({ id: `audit-${auditCalls.length}` })
  }

  if (url.startsWith('/api/history')) {
    if (method === 'POST') {
      const body = JSON.parse(init?.body ?? '{}')

      if (failPostForKind && body.kind === failPostForKind) {
        return jsonResponse({ error: 'History write failed' }, 500)
      }
      if (raceInjectionsRemaining > 0) {
        raceInjectionsRemaining--
        await pushServerCommit(body.documentId, {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: `racer ${clock}` }] },
          ],
        })
      }

      const parentHash = body.parentHash ?? null
      const annotationId = body.annotationId ?? null
      const auditIds = JSON.parse(body.auditIds ?? '[]')

      // Two-level verification, exactly like the route.
      const expectedContent = await computeContentHash(body.docJson)
      if (expectedContent !== body.contentHash) {
        return jsonResponse({ error: 'Content hash mismatch' }, 400)
      }
      const expectedHash = await computeCommitHash({
        documentId: body.documentId,
        parentHash,
        contentHash: body.contentHash,
        kind: body.kind,
        message: body.message,
        actor: body.actor ?? 'human',
        annotationId,
        auditIds,
        modelVersion: body.modelVersion ?? '',
      })
      if (expectedHash !== body.hash) return jsonResponse({ error: 'Hash mismatch' }, 400)

      const existing = commits.find((c) => c.hash === body.hash)
      if (existing) return jsonResponse({ hash: existing.hash, existing: true })

      if (parentHash) {
        if (!commits.some((c) => c.hash === parentHash && c.documentId === body.documentId)) {
          return jsonResponse({ error: 'Unknown parent' }, 400)
        }
        if (
          commits.some(
            (c) =>
              c.documentId === body.documentId &&
              c.parentHash === parentHash &&
              c.hash !== body.hash,
          )
        ) {
          return jsonResponse({ error: 'Stale head', reason: 'stale-head' }, 409)
        }
      } else if (commits.some((c) => c.documentId === body.documentId && c.hash !== body.hash)) {
        return jsonResponse({ error: 'Stale head', reason: 'stale-head' }, 409)
      }

      commits.push({
        hash: body.hash,
        contentHash: body.contentHash,
        documentId: body.documentId,
        parentHash,
        kind: body.kind,
        message: body.message,
        docJson: body.docJson,
        blockIdsTouched: body.blockIdsTouched ?? '[]',
        annotationId,
        auditIds: body.auditIds ?? '[]',
        actor: body.actor ?? 'human',
        modelVersion: body.modelVersion ?? '',
        createdAt: new Date(1700000000000 + clock++ * 1000).toISOString(),
      })
      return jsonResponse({ hash: body.hash })
    }

    const params = new URLSearchParams(url.split('?')[1] ?? '')
    const hash = params.get('hash')
    if (hash) {
      const found = commits.find((c) => c.hash === hash)
      return found ? jsonResponse({ commit: found }) : jsonResponse({ error: 'not found' }, 404)
    }
    const documentId = params.get('documentId')
    const rawLimit = Number(params.get('limit') ?? 100)
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 200) : 100
    const before = params.get('before')
    const list = commits
      .filter((c) => c.documentId === documentId)
      .filter((c) => (before ? new Date(c.createdAt) < new Date(before) : true))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit)
      .map(meta)
    return jsonResponse({ commits: list })
  }

  return jsonResponse({ error: 'unknown route' }, 404)
}

beforeEach(() => {
  commits = []
  auditCalls = []
  requestLog = []
  clock = 0
  raceInjectionsRemaining = 0
  failPostForKind = null
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function docJsonWithText(text: string) {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  }
}

/**
 * Schema-normalized docJson, exactly what `view.state.doc.toJSON()` yields in
 * production (includes default attrs like blockId). Restore tests must seed
 * with this form so editor round-trips hash identically to stored versions.
 */
function pmDocJson(text: string) {
  return Node.fromJSON(schema, docJsonWithText(text)).toJSON()
}

function makeView(docJson: any): EditorView {
  const view = {
    state: EditorState.create({ schema, doc: Node.fromJSON(schema, docJson) }),
    dispatch(tr: any) {
      view.state = view.state.apply(tr)
    },
  } as unknown as EditorView & { state: EditorState }
  return view
}

const historyPosts = () =>
  requestLog.filter((r) => r.url.startsWith('/api/history') && r.method === 'POST')

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createCommit', () => {
  it('creates a root version with a null parent and server-verifiable two-level hashes', async () => {
    const docJson = docJsonWithText('Hello')
    const { hash, noop } = await createCommit({
      docJson,
      documentId: 'doc-1',
      kind: 'import',
      message: 'Created "Test"',
    })

    const contentHash = await computeContentHash(docJson)
    expect(noop).toBe(false)
    expect(hash).toBe(
      await computeCommitHash({
        documentId: 'doc-1',
        parentHash: null,
        contentHash,
        kind: 'import',
        message: 'Created "Test"',
        actor: 'human',
        annotationId: null,
        auditIds: [],
        modelVersion: '',
      }),
    )
    expect(commits).toHaveLength(1)
    expect(commits[0].parentHash).toBeNull()
    expect(commits[0].contentHash).toBe(contentHash)
    expect(commits[0].kind).toBe('import')
  })

  it('chains the next version onto the head (parent pointer correctness)', async () => {
    const first = await createCommit({
      docJson: docJsonWithText('v1'),
      documentId: 'doc-1',
      kind: 'import',
      message: 'Created "Test"',
    })
    const second = await createCommit({
      docJson: docJsonWithText('v2'),
      documentId: 'doc-1',
      kind: 'direct',
      message: 'Edited document',
    })

    expect(second.hash).not.toBe(first.hash)
    expect(commits).toHaveLength(2)
    expect(commits[1].parentHash).toBe(first.hash)
    expect(await headCommit('doc-1')).toMatchObject({ hash: second.hash })
  })

  it("no-ops a 'direct' flush when the head already has this content (contentHash dedupe)", async () => {
    // Key-order variation must not defeat the dedupe: canonicalization.
    const first = await createCommit({
      docJson: { type: 'doc', content: [{ content: [{ text: 'same', type: 'text' }], type: 'paragraph' }] },
      documentId: 'doc-1',
      kind: 'import',
      message: 'Created "Test"',
    })
    const postsBefore = historyPosts().length

    const again = await createCommit({
      docJson: docJsonWithText('same'),
      documentId: 'doc-1',
      kind: 'direct',
      message: 'Edited document',
    })

    expect(again).toEqual({ hash: first.hash, noop: true })
    expect(commits).toHaveLength(1)
    expect(historyPosts().length).toBe(postsBefore) // no new POST at all
  })

  it("ALWAYS commits an 'apply' even when content matches the head — provenance is never collapsed", async () => {
    // The confirmed adversarial-review race: an 'apply' and a 'direct'
    // autosave land the same content on the same head. Under content-only
    // hashing the second write silently vanished, discarding the AI
    // provenance (kind/actor/auditIds). Two-level hashing makes them
    // distinct commits by construction.
    const doc = docJsonWithText('agreed content')
    const direct = await createCommit({
      docJson: doc,
      documentId: 'doc-1',
      kind: 'direct',
      message: 'Edited document',
    })
    const apply = await createCommit({
      docJson: doc,
      documentId: 'doc-1',
      kind: 'apply',
      message: 'AI change applied',
      annotationId: 'ann-1',
      auditIds: ['audit-9'],
      actor: 'ai+human',
      modelVersion: 'claude-sonnet-4-6',
    })

    expect(apply.noop).toBe(false)
    expect(apply.hash).not.toBe(direct.hash)
    expect(commits).toHaveLength(2)
    expect(commits[0].contentHash).toBe(commits[1].contentHash) // same tree
    expect(commits[1]).toMatchObject({
      kind: 'apply',
      actor: 'ai+human',
      annotationId: 'ann-1',
      auditIds: JSON.stringify(['audit-9']),
      parentHash: direct.hash,
    })
  })

  it('keeps histories of different documents independent', async () => {
    const sameDoc = docJsonWithText('shared')
    const h1 = await createCommit({ docJson: sameDoc, documentId: 'doc-1', kind: 'import', message: 'a' })
    const h2 = await createCommit({ docJson: sameDoc, documentId: 'doc-2', kind: 'import', message: 'b' })
    expect(h1.hash).not.toBe(h2.hash)
    expect(await listCommits('doc-1')).toHaveLength(1)
    expect(await listCommits('doc-2')).toHaveLength(1)
  })

  it('retries ONCE against the new head on a 409 stale-head, then succeeds', async () => {
    await createCommit({
      docJson: docJsonWithText('v1'),
      documentId: 'doc-1',
      kind: 'import',
      message: 'Created "Test"',
    })

    // The next POST is beaten by a concurrent writer → server 409s the first
    // attempt; the client must refetch the head, rehash, and land on top.
    raceInjectionsRemaining = 1
    const postsBefore = historyPosts().length
    const result = await createCommit({
      docJson: docJsonWithText('mine'),
      documentId: 'doc-1',
      kind: 'direct',
      message: 'Edited document',
    })

    expect(result.noop).toBe(false)
    expect(historyPosts().length).toBe(postsBefore + 2) // 409 attempt + retry
    expect(commits).toHaveLength(3) // v1, racer, mine
    const mine = commits.find((c) => c.hash === result.hash)!
    const racer = commits.find((c) => c.message.startsWith('concurrent writer'))!
    expect(mine.parentHash).toBe(racer.hash) // rebased onto the interloper
  })

  it('gives up (throws) when the head keeps moving after one retry', async () => {
    await createCommit({
      docJson: docJsonWithText('v1'),
      documentId: 'doc-1',
      kind: 'import',
      message: 'Created "Test"',
    })

    raceInjectionsRemaining = 2 // both attempts get beaten
    await expect(
      createCommit({
        docJson: docJsonWithText('mine'),
        documentId: 'doc-1',
        kind: 'direct',
        message: 'Edited document',
      }),
    ).rejects.toThrow(/advancing concurrently/)
    // Nothing of ours was written — only the two racers landed.
    expect(commits.filter((c) => c.message === 'Edited document')).toHaveLength(0)
  })
})

describe('restoreCommit', () => {
  async function seedTwoVersions() {
    const v1Json = pmDocJson('version one')
    const v2Json = pmDocJson('version two')
    const v1 = await createCommit({ docJson: v1Json, documentId: 'doc-1', kind: 'import', message: 'Created "Test"' })
    const v2 = await createCommit({ docJson: v2Json, documentId: 'doc-1', kind: 'direct', message: 'Edited document' })
    return { v1Json, v2Json, v1: v1.hash, v2: v2.hash }
  }

  it('persists FIRST (audit → restore version), and only then mutates the editor', async () => {
    const { v1Json, v2Json, v1, v2 } = await seedTwoVersions()

    const view = makeView(v2Json)
    const target = await getCommit(v1)
    expect(target).not.toBeNull()

    const result = await restoreCommit(view, target!, 'doc-1')

    // Editor shows the old content again.
    expect(result.noop).toBe(false)
    expect((view as any).state.doc.textContent).toBe('version one')

    // History gained a NEW version — nothing rewritten, chain intact.
    expect(commits).toHaveLength(3)
    const restore = commits[2]
    expect(restore.hash).toBe(result.hash)
    expect(restore.kind).toBe('restore')
    expect(restore.parentHash).toBe(v2) // parent = pre-restore head
    expect(restore.message).toBe(`Restored version ${v1.slice(0, 8)}`)
    expect(restore.actor).toBe('human')
    expect(JSON.parse(restore.docJson)).toEqual(v1Json)
    expect(commits[0].hash).toBe(v1) // originals untouched
    expect(commits[1].hash).toBe(v2)

    // Article 14 oversight record written BEFORE the version, and the version
    // carries its id — a real Article 12 link, not prose.
    expect(auditCalls).toHaveLength(1)
    expect(auditCalls[0]).toMatchObject({
      action: 'log',
      outputType: 'HUMAN_RESTORE',
      approvalStatus: 'APPROVED_HUMAN',
      modelName: 'human',
      queryClassification: 'HUMAN_RESTORE',
    })
    expect(JSON.parse(restore.auditIds)).toEqual(['audit-1'])

    const indexed = requestLog.map((r, i) => ({ ...r, i }))
    const auditPost = indexed.find((r) => r.url.startsWith('/api/audit'))!
    const restorePost = indexed
      .filter((r) => r.url.startsWith('/api/history') && r.method === 'POST')
      .pop()!
    expect(auditPost.i).toBeLessThan(restorePost.i)
  })

  it('flushes pending unsaved edits as a direct version BEFORE restoring (no typed tail lost)', async () => {
    const { v2 , v1 } = await seedTwoVersions()

    // The user typed after the last autosave: the editor is ahead of history.
    const typedJson = pmDocJson('version two plus unsaved typing')
    const view = makeView(typedJson)
    const target = await getCommit(v1)

    const result = await restoreCommit(view, target!, 'doc-1')

    // v1, v2, flush, restore — the typed tail is preserved in the chain.
    expect(commits).toHaveLength(4)
    const flush = commits[2]
    expect(flush.kind).toBe('direct')
    expect(flush.parentHash).toBe(v2)
    expect(JSON.parse(flush.docJson)).toEqual(typedJson)
    const restore = commits[3]
    expect(restore.hash).toBe(result.hash)
    expect(restore.parentHash).toBe(flush.hash)
    expect((view as any).state.doc.textContent).toBe('version one')
  })

  it('is a no-op when restoring to content identical to the head — no version, no audit record', async () => {
    const { v2Json, v2 } = await seedTwoVersions()

    const view = makeView(v2Json)
    const target = await getCommit(v2)

    const result = await restoreCommit(view, target!, 'doc-1')

    expect(result).toEqual({ hash: v2, noop: true })
    expect(commits).toHaveLength(2)
    expect(auditCalls).toHaveLength(0)
    expect((view as any).state.doc.textContent).toBe('version two')
  })

  it('throws WITHOUT touching the editor when the restore version cannot be persisted', async () => {
    const { v2Json, v1 } = await seedTwoVersions()

    const view = makeView(v2Json)
    const target = await getCommit(v1)

    failPostForKind = 'restore'
    await expect(restoreCommit(view, target!, 'doc-1')).rejects.toThrow()

    // Document unchanged on screen, history unchanged — the panel's
    // "Restore failed" toast is now TRUE.
    expect((view as any).state.doc.textContent).toBe('version two')
    expect(commits).toHaveLength(2)
  })
})

describe('blameBlock', () => {
  const makeMeta = (hash: string, createdAt: string, blockIds: string[]): CommitMeta => ({
    hash,
    contentHash: `content-${hash}`,
    documentId: 'doc-1',
    parentHash: null,
    kind: 'apply',
    message: hash,
    blockIdsTouched: JSON.stringify(blockIds),
    annotationId: null,
    auditIds: '[]',
    actor: 'ai+human',
    modelVersion: 'm',
    createdAt,
  })

  it('returns the newest version that touched the block', () => {
    const older = makeMeta('older', '2026-01-01T00:00:00Z', ['b1', 'b2'])
    const newer = makeMeta('newer', '2026-02-01T00:00:00Z', ['b2'])
    expect(blameBlock([newer, older], 'b2')?.hash).toBe('newer')
    expect(blameBlock([older, newer], 'b2')?.hash).toBe('newer') // order-insensitive
    expect(blameBlock([newer, older], 'b1')?.hash).toBe('older')
  })

  it('returns null when no version touched the block', () => {
    const only = makeMeta('only', '2026-01-01T00:00:00Z', ['b1'])
    expect(blameBlock([only], 'zzz')).toBeNull()
    expect(blameBlock([], 'b1')).toBeNull()
  })

  it('tolerates malformed blockIdsTouched metadata', () => {
    const broken = { ...makeMeta('broken', '2026-03-01T00:00:00Z', []), blockIdsTouched: 'not-json' }
    const good = makeMeta('good', '2026-01-01T00:00:00Z', ['b1'])
    expect(blameBlock([broken, good], 'b1')?.hash).toBe('good')
  })
})
