import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { computeCommitHash } from '@/lib/history/canonical'

/**
 * /api/history — append-only, content-addressed document version history.
 *
 * EU AI Act Article 12 record-keeping: every version of a document is kept as
 * an immutable snapshot in a linear parent-pointer chain. This endpoint ONLY
 * creates and reads records — no update or delete operations exist, and
 * restores are recorded as NEW versions (history is never rewritten).
 *
 * Integrity: the server recomputes the sha256 hash from
 * (canonical docJson + parentHash + documentId) and rejects mismatches, so a
 * stored hash always proves the stored content.
 */

const VALID_KINDS = new Set(['import', 'apply', 'direct', 'restore'])

// Metadata projection — docJson is only returned for single-version lookups.
const COMMIT_META_SELECT = {
  hash: true,
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
 *                     newest first, capped at 200 (?limit=N to narrow)
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
      const limit = Math.min(Number(searchParams.get('limit') ?? 200), 200)
      const commits = await prisma.docCommit.findMany({
        where: { documentId },
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
 * Body: { action: 'commit', hash, documentId, parentHash, kind, message,
 *         docJson, blockIdsTouched?, annotationId?, auditIds?, actor?,
 *         modelVersion? }
 *
 * Rejections:
 *   400 — hash mismatch (server recomputes from canonical payload)
 *   400 — parentHash given but no such version exists for the document
 *   409 — duplicate hash with a different payload
 *   200 — duplicate hash with an identical payload (idempotent re-send)
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
    const parentHash =
      typeof params.parentHash === 'string' && params.parentHash.length > 0
        ? params.parentHash
        : null

    if (!documentId || !docJson || !hash || !message || !VALID_KINDS.has(kind)) {
      return NextResponse.json(
        { error: 'hash, documentId, docJson, message, and a valid kind are required' },
        { status: 400 },
      )
    }

    // Integrity: the hash must prove the content. Recompute server-side.
    let expectedHash: string
    try {
      expectedHash = await computeCommitHash(docJson, parentHash, documentId)
    } catch {
      return NextResponse.json({ error: 'docJson is not valid JSON' }, { status: 400 })
    }
    if (expectedHash !== hash) {
      return NextResponse.json(
        { error: 'Hash mismatch: payload does not match its content address' },
        { status: 400 },
      )
    }

    // Idempotency: same hash + same payload is a no-op re-send; same hash with
    // a different payload is a conflict (never overwrite history).
    const existing = await prisma.docCommit.findUnique({ where: { hash } })
    if (existing) {
      const identical =
        existing.documentId === documentId &&
        existing.parentHash === parentHash &&
        existing.docJson === docJson
      if (identical) {
        return NextResponse.json({ hash: existing.hash, existing: true })
      }
      return NextResponse.json(
        { error: 'A different version with this hash already exists' },
        { status: 409 },
      )
    }

    // The parent must be a real version of the same document (linear chain).
    if (parentHash) {
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
    }

    const record = await prisma.docCommit.create({
      data: {
        hash,
        documentId,
        parentHash,
        kind,
        message,
        docJson,
        blockIdsTouched: typeof params.blockIdsTouched === 'string' ? params.blockIdsTouched : '[]',
        annotationId: typeof params.annotationId === 'string' ? params.annotationId : undefined,
        auditIds: typeof params.auditIds === 'string' ? params.auditIds : '[]',
        actor: typeof params.actor === 'string' ? params.actor : 'human',
        modelVersion: typeof params.modelVersion === 'string' ? params.modelVersion : '',
      },
    })
    return NextResponse.json({ hash: record.hash })
  } catch (err) {
    console.error('[/api/history] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'History write failed' },
      { status: 500 },
    )
  }
}
