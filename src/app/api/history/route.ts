import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { computeCommitHash, computeContentHash } from '@/lib/history/canonical'

/**
 * /api/history — append-only, content-addressed document version history.
 *
 * EU AI Act Article 12 record-keeping: every compliance-relevant version of a
 * document ('import' | 'apply' | 'restore') is kept as a snapshot in a linear
 * parent-pointer chain and is NEVER updated or deleted; restores are recorded
 * as NEW versions (history is never rewritten). Append-only is enforced at
 * the application layer; hash verification makes stored records tamper-
 * evident against partial modification.
 *
 * The one disclosed exception, scoped narrowly: 'direct' autosave-flush
 * commits (no AI provenance, no audit linkage) may be amended in place via
 * `action: 'amend'` below — a retention measure so an active editing session
 * doesn't grow one full-snapshot row per autosave forever. 'import' | 'apply'
 * | 'restore' are never amend targets. See docs/compliance.md.
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

/**
 * Version history stores FULL document snapshots server-side, unauthenticated.
 * On the public demo that would put visitor documents in the shared DB,
 * readable by anyone holding a documentId — so it is off in production unless
 * the operator opts in (HISTORY_ENABLED=1, e.g. a private self-host). Client
 * writes are fire-and-forget (recordCommit) and degrade gracefully.
 */
function historyDisabled(): NextResponse | null {
  if (process.env.NODE_ENV === 'production' && process.env.HISTORY_ENABLED !== '1') {
    return NextResponse.json(
      { error: 'Version history is disabled on this deployment' },
      { status: 403 },
    )
  }
  return null
}

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
  const disabled = historyDisabled()
  if (disabled) return disabled
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
  const disabled = historyDisabled()
  if (disabled) return disabled
  try {
    const body = await request.json()
    const { action, ...params } = body

    if (action === 'amend') {
      return await handleAmend(params)
    }

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

/** Internal signal: the amend target stopped being the head inside the transaction. */
class AmendStaleHeadError extends Error {}

/**
 * action: 'amend' — retention-only in-place replacement of a 'direct' commit.
 *
 * Body adds `targetHash`: the hash of the 'direct' row being replaced. The
 * new row takes the TARGET's own parentHash (it steps into the target's slot
 * in the chain), not the target's hash — this is not an append.
 *
 * Scoped narrowly and defended at every layer: only `kind: 'direct'` may be
 * submitted, only a `kind: 'direct'` target may be replaced, and the target
 * must currently be the head (no commit anywhere has it as a parent) or the
 * write is rejected exactly like a normal stale-head race — the client's
 * existing single-retry-on-409 logic recovers by refetching the head and
 * deciding fresh whether to amend again or append. 'import' | 'apply' |
 * 'restore' commits are never touched by this path.
 */
async function handleAmend(params: Record<string, unknown>) {
  const documentId = typeof params.documentId === 'string' ? params.documentId : ''
  const docJson = typeof params.docJson === 'string' ? params.docJson : ''
  const kind = typeof params.kind === 'string' ? params.kind : ''
  const message = typeof params.message === 'string' ? params.message : ''
  const hash = typeof params.hash === 'string' ? params.hash : ''
  const contentHash = typeof params.contentHash === 'string' ? params.contentHash : ''
  const actor = typeof params.actor === 'string' ? params.actor : 'human'
  const modelVersion = typeof params.modelVersion === 'string' ? params.modelVersion : ''
  const annotationId = typeof params.annotationId === 'string' ? params.annotationId : null
  const targetHash = typeof params.targetHash === 'string' ? params.targetHash : ''
  const parentHash =
    typeof params.parentHash === 'string' && params.parentHash.length > 0
      ? params.parentHash
      : null

  if (kind !== 'direct') {
    return NextResponse.json({ error: 'Only direct commits may be amended' }, { status: 400 })
  }
  if (!documentId || !docJson || !hash || !contentHash || !message || !targetHash) {
    return NextResponse.json(
      { error: 'hash, contentHash, documentId, docJson, message, and targetHash are required' },
      { status: 400 },
    )
  }

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

  // Integrity checks run against the PAYLOAD alone (they don't need the
  // target row) so a sequential idempotent re-send — whose target the first,
  // already-successful call already consumed — is recognized as a duplicate
  // before it can be misread as "amend target not found". Same ordering as
  // the 'commit' path above: verify, then check for a duplicate, then act.
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

  // Idempotency: identical amend re-send (the hash covers content AND
  // attribution, so a duplicate hash is a true full duplicate).
  const existing = await prisma.docCommit.findUnique({ where: { hash }, select: { hash: true } })
  if (existing) {
    return NextResponse.json({ hash: existing.hash, existing: true })
  }

  const target = await prisma.docCommit.findFirst({ where: { hash: targetHash, documentId } })
  if (!target) {
    // Most likely cause: another writer already amended or superseded this
    // row. Same recovery as a normal fork race — refetch head and retry.
    return NextResponse.json(
      { error: 'Amend target not found', reason: 'stale-head' },
      { status: 409 },
    )
  }
  if (target.kind !== 'direct') {
    return NextResponse.json({ error: 'Amend target is not a direct commit' }, { status: 400 })
  }
  if (parentHash !== target.parentHash) {
    return NextResponse.json(
      { error: "parentHash must match the amend target's own parent" },
      { status: 400 },
    )
  }

  try {
    const record = await prisma.$transaction(async (tx) => {
      // Re-verify inside the transaction: the target could have gained a
      // child (an 'apply'/'import'/'restore' or a racing amend) in the gap
      // between the read above and this write.
      const child = await tx.docCommit.findFirst({
        where: { documentId, parentHash: target.hash },
        select: { hash: true },
      })
      if (child) throw new AmendStaleHeadError()

      await tx.docCommit.delete({ where: { hash: target.hash } })
      return tx.docCommit.create({
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
    })
    return NextResponse.json({ hash: record.hash })
  } catch (amendErr) {
    if (amendErr instanceof AmendStaleHeadError) {
      return NextResponse.json(
        {
          error: 'Stale head: the amend target already has a newer version',
          reason: 'stale-head',
        },
        { status: 409 },
      )
    }
    // A concurrent identical amend can race past the checks above and
    // collide on the primary key — that is still an idempotent success.
    const racedExisting = await prisma.docCommit.findUnique({
      where: { hash },
      select: { hash: true },
    })
    if (racedExisting) {
      return NextResponse.json({ hash: racedExisting.hash, existing: true })
    }
    console.error('[/api/history amend] Error:', amendErr)
    return NextResponse.json(
      { error: amendErr instanceof Error ? amendErr.message : 'Amend failed' },
      { status: 500 },
    )
  }
}
