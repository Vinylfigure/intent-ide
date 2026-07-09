import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// Public-deployment guards: the demo shares one audit table across anonymous
// visitors, so reads are scoped per visitor, unscoped reads need the admin
// token, and writes are size-capped and softly rate limited.
//
// Known limitation (no auth on the demo): the visitor userId is client-supplied
// and unauthenticated — per-visitor scoping is a courtesy partition, not a
// security boundary. Real attribution requires accounts (future work).

const MAX_BODY_BYTES = 16 * 1024
const DEFAULT_FIELD_LIMIT = 512
const FIELD_LIMITS: Record<string, number> = {
  sourceDocuments: 4096,
  graphNodesUsed: 4096,
  overrideReason: 1024,
}

// Best-effort spam friction only: per-lambda-instance, resets on cold start.
const RATE_WINDOW_MS = 60_000
const RATE_MAX_WRITES = 30
const writeCounts = new Map<string, { count: number; windowStart: number }>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  if (writeCounts.size > 1000) {
    for (const [key, entry] of writeCounts) {
      if (now - entry.windowStart > RATE_WINDOW_MS) writeCounts.delete(key)
    }
    // Spoofed-IP flood within one window: cap memory over per-key fairness.
    if (writeCounts.size > 5000) writeCounts.clear()
  }
  const entry = writeCounts.get(ip)
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    writeCounts.set(ip, { count: 1, windowStart: now })
    return false
  }
  entry.count += 1
  return entry.count > RATE_MAX_WRITES
}

function clientIp(request: NextRequest): string {
  // x-real-ip is set by the Vercel edge and not client-spoofable there; the
  // leftmost x-forwarded-for hop is a client claim, so it's only the fallback.
  return (
    request.headers.get('x-real-ip') ||
    (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() ||
    'unknown'
  )
}

/**
 * GET /api/audit — Read audit log entries (read-only).
 *
 * Query params:
 *   ?limit=50 — max records to return (default 50, max 200)
 *   ?status=PENDING_REVIEW — filter by approvalStatus
 *   ?userId=<visitor-id> — scope to one visitor's records
 *
 * Unscoped reads (no userId) require `Authorization: Bearer $AUDIT_ADMIN_TOKEN`.
 * Fail closed: in production an unset token denies unscoped reads entirely;
 * only local dev (non-production, no token) keeps open access.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const limit = Math.min(Number(searchParams.get('limit') ?? 50), 200)
    const status = searchParams.get('status') || undefined
    const userId = searchParams.get('userId') || undefined

    if (!userId) {
      const adminToken = process.env.AUDIT_ADMIN_TOKEN
      const auth = request.headers.get('authorization') ?? ''
      const authorized = adminToken
        ? auth === `Bearer ${adminToken}`
        : process.env.NODE_ENV !== 'production'
      if (!authorized) {
        return NextResponse.json(
          { error: 'Unscoped audit reads require the admin token' },
          { status: 401 },
        )
      }
    }

    const where = {
      ...(status ? { approvalStatus: status } : {}),
      ...(userId ? { userId } : {}),
    }

    const records = await prisma.auditLog.findMany({
      orderBy: { timestampUTC: 'desc' },
      take: limit,
      ...(Object.keys(where).length ? { where } : {}),
    })

    return NextResponse.json({ records })
  } catch (err) {
    console.error('[/api/audit GET] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch audit logs' },
      { status: 500 },
    )
  }
}

/**
 * POST /api/audit — Append-only audit log writer.
 *
 * EU AI Act Article 12 compliance: every AI transaction is logged.
 * This endpoint ONLY creates records — no update or delete operations.
 * Oversize fields are rejected (400), never silently truncated: several fields
 * hold JSON arrays, and a mid-string cut would store corrupt provenance.
 */
export async function POST(request: NextRequest) {
  try {
    // Fast-path on the declared size, then enforce on the actual body —
    // chunked transfers carry no content-length header.
    const declaredBytes = Number(request.headers.get('content-length') ?? 0)
    if (declaredBytes > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    }
    const raw = await request.text()
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    }

    if (isRateLimited(clientIp(request))) {
      return NextResponse.json({ error: 'Too many audit writes' }, { status: 429 })
    }

    const body = JSON.parse(raw)
    const { action, ...params } = body

    if (action === 'log') {
      // Required-shape string fields: non-strings fall back, oversize rejects.
      const stringDefs: Array<[field: string, fallback: string]> = [
        ['userId', 'local'],
        ['modelName', ''],
        ['modelVersion', ''],
        ['promptVersion', ''],
        ['promptHash', ''],
        ['queryClassification', ''],
        ['sourceDocuments', '[]'],
        ['responseId', ''],
        ['outputType', 'RESOLUTION'],
        ['regulatoryContext', 'EU_AI_ACT'],
        ['approvalStatus', 'PENDING_REVIEW'],
        ['graphNodesUsed', '[]'],
      ]
      const fields: Record<string, string> = {}
      for (const [field, fallback] of stringDefs) {
        const value = typeof params[field] === 'string' ? params[field] : fallback
        const limit = FIELD_LIMITS[field] ?? DEFAULT_FIELD_LIMIT
        if (value.length > limit) {
          return NextResponse.json(
            { error: `Field too long: ${field} (max ${limit} chars)` },
            { status: 400 },
          )
        }
        fields[field] = value
      }

      const overrideReason =
        typeof params.overrideReason === 'string' ? params.overrideReason : undefined
      if (overrideReason && overrideReason.length > FIELD_LIMITS.overrideReason) {
        return NextResponse.json(
          { error: `Field too long: overrideReason (max ${FIELD_LIMITS.overrideReason} chars)` },
          { status: 400 },
        )
      }

      const record = await prisma.auditLog.create({
        data: {
          userId: fields.userId,
          modelName: fields.modelName,
          modelVersion: fields.modelVersion,
          promptVersion: fields.promptVersion,
          promptHash: fields.promptHash,
          queryClassification: fields.queryClassification,
          sourceDocuments: fields.sourceDocuments,
          responseId: fields.responseId,
          outputType: fields.outputType,
          regulatoryContext: fields.regulatoryContext,
          approvalStatus: fields.approvalStatus,
          graphNodesUsed: fields.graphNodesUsed,
          resolutionId: typeof params.resolutionId === 'string' ? params.resolutionId : undefined,
          confidenceScore:
            typeof params.confidenceScore === 'number' && Number.isFinite(params.confidenceScore)
              ? params.confidenceScore
              : null,
          dataRetentionDays:
            typeof params.dataRetentionDays === 'number' && Number.isFinite(params.dataRetentionDays)
              ? Math.trunc(params.dataRetentionDays)
              : 2555,
          overrideOf: typeof params.overrideOf === 'string' ? params.overrideOf : undefined,
          overrideReason,
        },
      })
      return NextResponse.json({ id: record.id })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('[/api/audit] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Audit logging failed' },
      { status: 500 },
    )
  }
}
