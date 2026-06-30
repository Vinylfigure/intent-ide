import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

/**
 * GET /api/audit — Read audit log entries (read-only).
 *
 * Query params:
 *   ?limit=50 — max records to return (default 50, max 200)
 *   ?status=PENDING_REVIEW — filter by approvalStatus
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const limit = Math.min(Number(searchParams.get('limit') ?? 50), 200)
    const status = searchParams.get('status') || undefined

    const records = await prisma.auditLog.findMany({
      orderBy: { timestampUTC: 'desc' },
      take: limit,
      ...(status ? { where: { approvalStatus: status } } : {}),
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
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, ...params } = body

    if (action === 'log') {
      const record = await prisma.auditLog.create({
        data: {
          resolutionId: params.resolutionId ?? undefined,
          userId: params.userId ?? 'local',
          modelName: params.modelName ?? '',
          modelVersion: params.modelVersion ?? '',
          promptVersion: params.promptVersion ?? '',
          promptHash: params.promptHash ?? '',
          queryClassification: params.queryClassification ?? '',
          sourceDocuments: params.sourceDocuments ?? '[]',
          confidenceScore: params.confidenceScore ?? null,
          responseId: params.responseId ?? '',
          outputType: params.outputType ?? 'RESOLUTION',
          regulatoryContext: params.regulatoryContext ?? 'EU_AI_ACT',
          approvalStatus: params.approvalStatus ?? 'PENDING_REVIEW',
          dataRetentionDays: params.dataRetentionDays ?? 2555,
          graphNodesUsed: params.graphNodesUsed ?? '[]',
          overrideOf: params.overrideOf ?? undefined,
          overrideReason: params.overrideReason ?? undefined,
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
