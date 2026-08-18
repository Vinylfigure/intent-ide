import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

/**
 * /api/invariants — Document Invariant Ledger, Phase 1 (data model + capture
 * only; see issue #26). A user-declared fact ("terminations are now 30
 * days"), captured at SemanticCommitModal confirm time and linked to the
 * block(s) that evidence it.
 *
 * This endpoint ONLY creates and reads records — no update or delete
 * operations exist. The check runner that regression-tests these against
 * later document edits, and CascadeList surfacing of a failing invariant,
 * are a separate follow-up task (#20 steps 2-3); this route only stores what
 * that runner will eventually read.
 */

const VALID_CHECK_KINDS = new Set(['deterministic', 'entailment'])

const MAX_STATEMENT_CHARS = 2000
const MAX_BLOCK_IDS = 50
const MAX_BLOCK_ID_CHARS = 200

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200

const INVARIANT_SELECT = {
  id: true,
  documentId: true,
  statement: true,
  blockIds: true,
  checkKind: true,
  status: true,
  provenanceCommitHash: true,
  createdAt: true,
} as const

/**
 * GET /api/invariants?documentId=... — list a document's invariants, newest
 * first (default page of 100, ?limit=N up to 200).
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

    const invariants = await prisma.docInvariant.findMany({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: INVARIANT_SELECT,
    })
    return NextResponse.json({ invariants })
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
