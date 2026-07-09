import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { computeCommitHash, computeContentHash } from '@/lib/history/canonical'

/**
 * /api/history — append-only, content-addressed document version history.
 *
 * EU AI Act Article 12 record-keeping: every version of a document is kept as
 * a snapshot in a linear parent-pointer chain. This endpoint ONLY creates and
 * reads records — no update or delete operations exist, and restores are
 * recorded as NEW versions (history is never rewritten). Append-only is
 * enforced at the application layer; hash verification makes stored records
 * tamper-evident against partial modification.
 *
 * Integrity (two-level, git's design):
 *   - contentHash = sha256(canonical docJson)               — the "tree"
 *   - hash        = sha256(canonical join of documentId, parentHash,
 *                    contentHash, kind, message, actor, annotationId,
 *                    auditIds, modelVersion)                 — the "commit"
 * The server recomputes BOTH from the payload and rejects either mismatch,
 * so a stored hash proves the stored content AND its attribution.
 *
 * Linearity: one root per document, one child per parent. A write that would
 * fork the chain is rejected with 409 { reason: 'stale-head' } so the client
 * can rebase onto the new head and retry.
 */

const VALID_KINDS = new Set(['import', 'apply', 'direct', 'restore'])

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200

// Metadata projection — docJson is only returned for single-version lookups.
const COMMIT_META_SELECT = {
  hash: true,
  contentHash: true,
  documentId: true,
  parentHash: true,
  kind: true,
  message: true,
  blockIdsTouched: true,
  annotationId: true,
  auditIds: true,
  actor: true,
  modelVersion: true,
  createdAt: true,
} as const

/**
 * GET /api/history — read version history (read-only).
 *
 * Query params:
 *   ?documentId=... — version metadata for a document (no docJson),
 *                     newest first, default page of 100 (?limit=N, 1..200)
 *   &before=<ISO>   — cursor: only versions strictly older than this
 *                     createdAt (for paging past the first page)
 *   ?hash=...       — one version, including its full docJson
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const hash = searchParams.get('hash')
    const documentId = searchParams.get('documentId')

    if (hash) {
      const commit = await prisma.docCommit.findUnique({ where: { hash } })
      if (!commit) {
        return NextResponse.json({ error: 'Version not found' }, { status: 404 })
      }
      return NextResponse.json({ commit })
    }

    if (documentId) {
      // Sanitize limit: NaN, negatives, and out-of-range values must never
      // reach Prisma as take:NaN / take:-n.
      const rawLimit = Number(searchParams.get('limit') ?? DEFAULT_LIMIT)
      const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(Math.floor(rawLimit), 1), MAX_LIMIT)
        : DEFAULT_LIMIT

      const beforeParam = searchParams.get('before')
      const before = beforeParam ? new Date(beforeParam) : null
      const useBefore = before !== null && !Number.isNaN(before.getTime())

      const commits = await prisma.docCommit.findMany({
        where: useBefore ? { documentId, createdAt: { lt: before } } : { documentId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: COMMIT_META_SELECT,
      })
      return NextResponse.json({ commits })
    }

    return NextResponse.json(
      { error: 'documentId or hash query param required' },
      { status: 400 },
    )
  } catch (err) {
    console.error('[/api/history GET] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch history' },
      { status: 500 },
    )
  }
}

/**
 * POST /api/history — append-only version writer.
 *
 * Body: { action: 'commit', hash, contentHash, documentId, parentHash, kind,
 *         message, docJson, blockIdsTouched?, annotationId?, auditIds?,
 *         actor?, modelVersion? }
 *
 * Responses:
 *   400 — contentHash mismatch (server recomputes from canonical docJson)
 *   400 — hash mismatch (server recomputes from content + attribution)
 *   400 — parentHash given but no such version exists for the document
 *   409 { reason: 'stale-head' } — the parent already has a child, or a root
 *         already exists (a write that would fork the chain)
 *   200 — duplicate hash (a true full duplicate by construction: the hash
 *         covers content and attribution) — idempotent re-send
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, ...params } = body

    if (action !== 'commit') {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }

    const documentId = typeof params.documentId === 'string' ? params.documentId : ''
    const docJson = typeof params.docJson === 'string' ? params.docJson : ''
    const kind = typeof params.kind === 'string' ? params.kind : ''
    const message = typeof params.message === 'string' ? params.message : ''
    const hash = typeof params.hash === 'string' ? params.hash : ''
    const contentHash = typeof params.contentHash === 'string' ? params.contentHash : ''
    const actor = typeof params.actor === 'string' ? params.actor : 'human'
    const modelVersion = typeof params.modelVersion === 'string' ? params.modelVersion : ''
    const annotationId = typeof params.annotationId === 'string' ? params.annotationId : null
    const parentHash =
      typeof params.parentHash === 'string' && params.parentHash.length > 0
        ? params.parentHash
        : null

    if (!documentId || !docJson || !hash || !contentHash || !message || !VALID_KINDS.has(kind)) {
      return NextResponse.json(
        {
          error:
            'hash, contentHash, documentId, docJson, message, and a valid kind are required',
        },
        { status: 400 },
      )
    }

    // auditIds arrives as a JSON string; its parsed array form is part of the
    // commit-hash payload, so it must be a well-formed string array.
    let auditIds: string[]
    try {
      const parsed: unknown = JSON.parse(
        typeof params.auditIds === 'string' ? params.auditIds : '[]',
      )
      if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string')) {
        throw new Error('not a string array')
      }
      auditIds = parsed
    } catch {
      return NextResponse.json(
        { error: 'auditIds must be a JSON array of strings' },
        { status: 400 },
      )
    }

    // Integrity level 1: the content hash must prove the content.
    let expectedContentHash: string
    try {
      expectedContentHash = await computeContentHash(docJson)
    } catch {
      return NextResponse.json({ error: 'docJson is not valid JSON' }, { status: 400 })
    }
    if (expectedContentHash !== contentHash) {
      return NextResponse.json(
        { error: 'Content hash mismatch: docJson does not match its content address' },
        { status: 400 },
      )
    }

    // Integrity level 2: the commit hash must prove content + attribution.
    const expectedHash = await computeCommitHash({
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
    if (expectedHash !== hash) {
      return NextResponse.json(
        { error: 'Hash mismatch: payload does not match its commit address' },
        { status: 400 },
      )
    }

    // Idempotency: the hash covers content AND attribution, so a duplicate
    // hash is a true full duplicate — treat the re-send as a no-op.
    const existing = await prisma.docCommit.findUnique({
      where: { hash },
      select: { hash: true },
    })
    if (existing) {
      return NextResponse.json({ hash: existing.hash, existing: true })
    }

    if (parentHash) {
      // The parent must be a real version of the same document.
      const parent = await prisma.docCommit.findFirst({
        where: { hash: parentHash, documentId },
        select: { hash: true },
      })
      if (!parent) {
        return NextResponse.json(
          { error: 'parentHash does not reference a version of this document' },
          { status: 400 },
        )
      }
      // Linearity: one child per parent. A second child means the writer's
      // head is stale — reject so it can rebase and retry. (A row with the
      // SAME hash is not a fork — it's a concurrent identical re-send, which
      // the unique-constraint catch below resolves idempotently.)
      const sibling = await prisma.docCommit.findFirst({
        where: { documentId, parentHash, NOT: { hash } },
        select: { hash: true },
      })
      if (sibling) {
        return NextResponse.json(
          {
            error: 'Stale head: this parent already has a newer version',
            reason: 'stale-head',
          },
          { status: 409 },
        )
      }
    } else {
      // Linearity: one root per document (same identical-re-send carve-out).
      const anyCommit = await prisma.docCommit.findFirst({
        where: { documentId, NOT: { hash } },
        select: { hash: true },
      })
      if (anyCommit) {
        return NextResponse.json(
          {
            error: 'Stale head: this document already has a version history',
            reason: 'stale-head',
          },
          { status: 409 },
        )
      }
    }

    try {
      const record = await prisma.docCommit.create({
        data: {
          hash,
          contentHash,
          documentId,
          parentHash,
          kind,
          message,
          docJson,
          blockIdsTouched:
            typeof params.blockIdsTouched === 'string' ? params.blockIdsTouched : '[]',
          annotationId: annotationId ?? undefined,
          auditIds: JSON.stringify(auditIds),
          actor,
          modelVersion,
        },
      })
      return NextResponse.json({ hash: record.hash })
    } catch (createErr) {
      // Two concurrent IDENTICAL POSTs can race past the duplicate check and
      // collide on the primary key — that is still an idempotent success.
      const racedExisting = await prisma.docCommit.findUnique({
        where: { hash },
        select: { hash: true },
      })
      if (racedExisting) {
        return NextResponse.json({ hash: racedExisting.hash, existing: true })
      }
      throw createErr
    }
  } catch (err) {
    console.error('[/api/history] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'History write failed' },
      { status: 500 },
    )
  }
}
