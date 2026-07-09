import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { Node } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import { schema } from '@/lib/prosemirror/schema'
import { computeCommitHash } from '../canonical'
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
// route's contract. Follows the fetch-stub precedent from
// documentStore.phase8.test.ts.
// ---------------------------------------------------------------------------

interface StoredCommit {
  hash: string
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
      const parentHash = body.parentHash ?? null
      const expected = await computeCommitHash(body.docJson, parentHash, body.documentId)
      if (expected !== body.hash) return jsonResponse({ error: 'Hash mismatch' }, 400)
      const existing = commits.find((c) => c.hash === body.hash)
      if (existing) return jsonResponse({ hash: existing.hash, existing: true })
      if (parentHash && !commits.some((c) => c.hash === parentHash && c.documentId === body.documentId)) {
        return jsonResponse({ error: 'Unknown parent' }, 400)
      }
      commits.push({
        hash: body.hash,
        documentId: body.documentId,
        parentHash,
        kind: body.kind,
        message: body.message,
        docJson: body.docJson,
        blockIdsTouched: body.blockIdsTouched ?? '[]',
        annotationId: body.annotationId ?? null,
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
    const limit = Number(params.get('limit') ?? 200)
    const list = commits
      .filter((c) => c.documentId === documentId)
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
  it('creates a root version with a null parent and a server-verifiable hash', async () => {
    const docJson = docJsonWithText('Hello')
    const hash = await createCommit({
      docJson,
      documentId: 'doc-1',
      kind: 'import',
      message: 'Created "Test"',
    })

    expect(hash).toBe(await computeCommitHash(docJson, null, 'doc-1'))
    expect(commits).toHaveLength(1)
    expect(commits[0].parentHash).toBeNull()
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

    expect(second).not.toBe(first)
    expect(commits).toHaveLength(2)
    expect(commits[1].parentHash).toBe(first)
    expect(await headCommit('doc-1')).toMatchObject({ hash: second })
  })

  it('no-ops when content is unchanged (hash dedupe), returning the head hash', async () => {
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

    expect(again).toBe(first)
    expect(commits).toHaveLength(1)
    expect(historyPosts().length).toBe(postsBefore) // no new POST at all
  })

  it('keeps histories of different documents independent', async () => {
    const sameDoc = docJsonWithText('shared')
    const h1 = await createCommit({ docJson: sameDoc, documentId: 'doc-1', kind: 'import', message: 'a' })
    const h2 = await createCommit({ docJson: sameDoc, documentId: 'doc-2', kind: 'import', message: 'b' })
    expect(h1).not.toBe(h2)
    expect(await listCommits('doc-1')).toHaveLength(1)
    expect(await listCommits('doc-2')).toHaveLength(1)
  })
})

describe('restoreCommit', () => {
  it('replaces editor content, appends a restore version on the pre-restore head, then logs oversight', async () => {
    const v1Json = docJsonWithText('version one')
    const v2Json = docJsonWithText('version two')
    const v1 = await createCommit({ docJson: v1Json, documentId: 'doc-1', kind: 'import', message: 'Created "Test"' })
    const v2 = await createCommit({ docJson: v2Json, documentId: 'doc-1', kind: 'direct', message: 'Edited document' })

    const view = makeView(v2Json)
    const target = await getCommit(v1)
    expect(target).not.toBeNull()

    const restoredHash = await restoreCommit(view, target!, 'doc-1')

    // 1. Editor now shows the old content.
    expect((view as any).state.doc.textContent).toBe('version one')

    // 2. History gained a NEW version — nothing rewritten, chain intact.
    expect(commits).toHaveLength(3)
    const restore = commits[2]
    expect(restore.hash).toBe(restoredHash)
    expect(restore.kind).toBe('restore')
    expect(restore.parentHash).toBe(v2) // parent = pre-restore head
    expect(restore.message).toBe(`Restored version ${v1.slice(0, 8)}`)
    expect(restore.actor).toBe('human')
    expect(JSON.parse(restore.docJson)).toEqual(v1Json)
    expect(commits[0].hash).toBe(v1) // originals untouched
    expect(commits[1].hash).toBe(v2)

    // 3. Article 14 oversight record, written AFTER the version commit.
    expect(auditCalls).toHaveLength(1)
    expect(auditCalls[0]).toMatchObject({
      action: 'log',
      outputType: 'HUMAN_RESTORE',
      approvalStatus: 'APPROVED_HUMAN',
      modelName: 'human',
      queryClassification: 'HUMAN_RESTORE',
    })
    const indexed = requestLog.map((r, i) => ({ ...r, i }))
    const lastHistoryPost = indexed
      .filter((r) => r.url.startsWith('/api/history') && r.method === 'POST')
      .pop()!
    const auditPost = indexed.find((r) => r.url.startsWith('/api/audit'))!
    expect(lastHistoryPost.i).toBeLessThan(auditPost.i)
  })
})

describe('blameBlock', () => {
  const makeMeta = (hash: string, createdAt: string, blockIds: string[]): CommitMeta => ({
    hash,
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
