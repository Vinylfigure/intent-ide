import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { INVARIANT_SELECT } from '@/lib/invariants/invariantSelect'

/**
 * /api/invariants — Document Invariant Ledger. A user-declared fact
 * ("terminations are now 30 days"), captured at SemanticCommitModal confirm
 * time and linked to the block(s) that evidence it (Phase 1, #26). The
 * deterministic check runner re-evaluates active rows against later document
 * edits (Phase 2, #32).
 *
 * This route creates and reads records — no PATCH/DELETE exist, and no row's
 * `statement`/`blockIds`/`provenanceCommitHash` is ever rewritten in place. A
 * status transition (e.g. dismissing a surfaced conflict) is a separate
 * append-only write at POST /api/invariants/resolve (Phase 3, #35), which
 * appends a NEW row pointing `supersedesId` at the one it resolves rather
 * than mutating it — see the schema doc-comment on `DocInvariant` for the
 * full rationale. GET computes the "live" (not-yet-superseded) set below.
 */

const VALID_CHECK_KINDS = new Set(['deterministic', 'entailment'])

const MAX_STATEMENT_CHARS = 2000
const MAX_BLOCK_IDS = 50
const MAX_BLOCK_ID_CHARS = 200

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200
// Upper bound on how many of a document's rows (across both original facts
// and their resolve/supersede rows) GET scans to compute the live set. Rows
// beyond this cutoff (ordered newest-first) are invisible to this endpoint —
// a disclosed limit, not silently unbounded, matching this app's public-
// exposure hardening posture elsewhere (e.g. /api/audit's body cap). The
// `before`/`beforeId` cursor below (#56) lets a caller page past MAX_LIMIT,
// but it pages over the live set computed from THIS scan window — a document
// whose live set exceeds SUPERSEDE_SCAN_CAP still has rows beyond the cutoff
// that no cursor value can reach (surfaced to callers as `scanTruncated` on
// the response, so a null `nextCursor` there isn't mistaken for "no more
// data exists"). Each resolve now leaves BOTH the original and its
// resolution row present in the DB (only the original drops out of the live
// view), so an actively-dismissed document's live-row count grows faster
// post-#35 than pre-#35.
const SUPERSEDE_SCAN_CAP = 2000

/**
 * GET /api/invariants?documentId=... — list a document's LIVE invariants
 * (rows no other row supersedes), newest first (default page of 100,
 * ?limit=N up to 200). A row that has been resolved/superseded is excluded;
 * the row recording that resolution (status 'resolved'|'superseded') takes
 * its place in the result if it is itself still live — which it always is
 * unless something later supersedes it too.
 *
 * `&before=<ISO>&beforeId=<id>` (#56) pages past the first page: only live
 * rows strictly after the given (createdAt, id) pair — in the same
 * createdAt-desc/id-desc order the query itself uses — are returned. Both
 * must be given together; either alone is treated as no cursor. `createdAt`
 * alone is not a safe cursor key: two rows created in the same millisecond
 * (concurrent POSTs) would tie under a timestamp-only comparison, silently
 * dropping or duplicating one of them across the page boundary. `id` breaks
 * the tie deterministically instead — it doesn't need to be chronologically
 * meaningful, only stable, and `orderBy` below sorts by it explicitly so
 * every request (and thus every page) sees the same tie order.
 *
 * The response's `nextCursor`/`nextCursorId` are that pair for the last row
 * on this page, or both null once the live set (within the scan window
 * below) is exhausted. `scanTruncated: true` means this document has more
 * raw rows than `SUPERSEDE_SCAN_CAP` — in that case a null `nextCursor` means
 * only "no more pages within what this endpoint scanned," not "no more live
 * invariants exist"; older ones beyond the scan window are unreachable here.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const documentId = searchParams.get('documentId')
    if (!documentId) {
      return NextResponse.json({ error: 'documentId query param required' }, { status: 400 })
    }

    const rawLimit = Number(searchParams.get('limit') ?? DEFAULT_LIMIT)
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.floor(rawLimit), 1), MAX_LIMIT)
      : DEFAULT_LIMIT

    const beforeParam = searchParams.get('before')
    const beforeIdParam = searchParams.get('beforeId')
    const beforeDate = beforeParam ? new Date(beforeParam) : null
    const useBefore =
      beforeDate !== null && !Number.isNaN(beforeDate.getTime()) && !!beforeIdParam

    const scanned = await prisma.docInvariant.findMany({
      where: { documentId },
      // Secondary sort by id makes ordering deterministic across separate
      // requests even when two rows share a createdAt millisecond — required
      // for the cursor's tiebreak below to mean the same thing on every page.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: SUPERSEDE_SCAN_CAP,
      select: INVARIANT_SELECT,
    })
    const scanTruncated = scanned.length >= SUPERSEDE_SCAN_CAP
    const supersededIds = new Set(
      scanned.filter((r) => r.supersedesId).map((r) => r.supersedesId as string),
    )
    const live = scanned.filter((r) => !supersededIds.has(r.id))
    // The cursor filters the LIVE set (not the raw scan) — supersede status
    // is resolved above from the full scan window so a resolve row on an
    // earlier page still correctly hides the original it supersedes on a
    // later one, even though the resolve row itself isn't on that later page.
    const page = useBefore
      ? live.filter((r) => {
          const rt = r.createdAt.getTime()
          const bt = beforeDate!.getTime()
          return rt !== bt ? rt < bt : r.id < (beforeIdParam as string)
        })
      : live
    const invariants = page.slice(0, limit)
    const last = invariants[invariants.length - 1]
    const hasMore = page.length > limit
    const nextCursor = hasMore && last ? last.createdAt.toISOString() : null
    const nextCursorId = hasMore && last ? last.id : null
    return NextResponse.json({ invariants, nextCursor, nextCursorId, scanTruncated })
  } catch (err) {
    console.error('[/api/invariants GET] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch invariants' },
      { status: 500 },
    )
  }
}

/**
 * POST /api/invariants — append-only invariant writer.
 *
 * Body: { documentId, statement, blockIds?: string[], checkKind?:
 *         'deterministic' | 'entailment', provenanceCommitHash?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const documentId = typeof body.documentId === 'string' ? body.documentId : ''
    const statement = typeof body.statement === 'string' ? body.statement.trim() : ''
    if (!documentId || !statement) {
      return NextResponse.json(
        { error: 'documentId and statement are required' },
        { status: 400 },
      )
    }
    if (statement.length > MAX_STATEMENT_CHARS) {
      return NextResponse.json(
        { error: `statement too long (max ${MAX_STATEMENT_CHARS} chars)` },
        { status: 400 },
      )
    }

    const rawBlockIds: unknown = body.blockIds
    let blockIds: string[] = []
    if (rawBlockIds !== undefined) {
      if (
        !Array.isArray(rawBlockIds) ||
        rawBlockIds.some((id) => typeof id !== 'string')
      ) {
        return NextResponse.json({ error: 'blockIds must be an array of strings' }, { status: 400 })
      }
      if (rawBlockIds.length > MAX_BLOCK_IDS) {
        return NextResponse.json(
          { error: `too many blockIds (max ${MAX_BLOCK_IDS})` },
          { status: 400 },
        )
      }
      if (rawBlockIds.some((id) => id.length > MAX_BLOCK_ID_CHARS)) {
        return NextResponse.json({ error: 'blockId too long' }, { status: 400 })
      }
      blockIds = rawBlockIds
    }

    const checkKind = typeof body.checkKind === 'string' ? body.checkKind : 'deterministic'
    if (!VALID_CHECK_KINDS.has(checkKind)) {
      return NextResponse.json(
        { error: `checkKind must be one of: ${[...VALID_CHECK_KINDS].join(', ')}` },
        { status: 400 },
      )
    }

    const provenanceCommitHash =
      typeof body.provenanceCommitHash === 'string' && body.provenanceCommitHash.length > 0
        ? body.provenanceCommitHash
        : null

    const record = await prisma.docInvariant.create({
      data: {
        documentId,
        statement,
        blockIds: JSON.stringify(blockIds),
        checkKind,
        provenanceCommitHash: provenanceCommitHash ?? undefined,
      },
      select: INVARIANT_SELECT,
    })
    return NextResponse.json({ invariant: record })
  } catch (err) {
    console.error('[/api/invariants] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invariant capture failed' },
      { status: 500 },
    )
  }
}
