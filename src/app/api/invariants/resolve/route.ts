import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { INVARIANT_SELECT } from '@/lib/invariants/invariantSelect'

/**
 * /api/invariants/resolve — Document Invariant Ledger, Phase 3 (#35). Ends a
 * DocInvariant row's currency (e.g. the user clicked "Nevermind" on a
 * surfaced conflict, or a newly declared fact explicitly replaces an older
 * one) WITHOUT mutating the original row.
 *
 * Append-only, git-model: this creates a NEW row that duplicates the target
 * row's evidentiary content (`statement`/`blockIds`/`checkKind`/
 * `provenanceCommitHash`) forward — the same full-snapshot-per-version shape
 * `DocCommit` uses — with `status` set to the requested value and
 * `supersedesId` pointing at the row it replaces, mirroring
 * `DocCommit.parentHash`. The original row's own columns are never written
 * to. GET /api/invariants treats a row as "live" iff nothing else's
 * `supersedesId` points at it, so the target stops being checked without its
 * history being rewritten — chosen over an in-place PATCH because it matches
 * this project's "tamper-evident, not immutable, but auditable" posture
 * (docs/compliance.md) instead of introducing the one kind of row in this
 * ledger whose evidentiary fields CAN silently change after the fact.
 */

const VALID_STATUSES = new Set(['resolved', 'superseded'])

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const documentId = typeof body.documentId === 'string' ? body.documentId : ''
    const invariantId = typeof body.invariantId === 'string' ? body.invariantId : ''
    const status = typeof body.status === 'string' ? body.status : ''
    if (!documentId || !invariantId) {
      return NextResponse.json(
        { error: 'documentId and invariantId are required' },
        { status: 400 },
      )
    }
    if (!VALID_STATUSES.has(status)) {
      return NextResponse.json(
        { error: `status must be one of: ${[...VALID_STATUSES].join(', ')}` },
        { status: 400 },
      )
    }

    const target = await prisma.docInvariant.findUnique({ where: { id: invariantId } })
    if (!target || target.documentId !== documentId) {
      return NextResponse.json({ error: 'invariant not found' }, { status: 404 })
    }

    // Fast-path pre-check (findUnique on the unique `supersedesId` column) —
    // gives a clean 409 in the ordinary sequential case. This alone is NOT
    // race-safe (two concurrent requests can both pass it before either
    // writes); the schema's `@unique` constraint on `supersedesId` is the
    // actual correctness guarantee, enforced by the catch block below.
    const alreadySuperseded = await prisma.docInvariant.findUnique({
      where: { supersedesId: invariantId },
      select: { id: true },
    })
    if (alreadySuperseded) {
      return NextResponse.json(
        { error: 'invariant already resolved or superseded' },
        { status: 409 },
      )
    }

    try {
      const record = await prisma.docInvariant.create({
        data: {
          documentId: target.documentId,
          statement: target.statement,
          blockIds: target.blockIds,
          checkKind: target.checkKind,
          provenanceCommitHash: target.provenanceCommitHash ?? undefined,
          status,
          supersedesId: invariantId,
        },
        select: INVARIANT_SELECT,
      })
      return NextResponse.json({ invariant: record })
    } catch (createErr) {
      // A concurrent request can race past the pre-check above and collide
      // on the unique `supersedesId` constraint — same idempotent-collision
      // pattern /api/history uses for its own unique-constraint race. Confirm
      // it really was that constraint (a row for this target now exists)
      // before reporting 409; anything else is a genuine 500.
      const racedExisting = await prisma.docInvariant.findUnique({
        where: { supersedesId: invariantId },
        select: { id: true },
      })
      if (racedExisting) {
        return NextResponse.json(
          { error: 'invariant already resolved or superseded' },
          { status: 409 },
        )
      }
      throw createErr
    }
  } catch (err) {
    console.error('[/api/invariants/resolve] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invariant resolve failed' },
      { status: 500 },
    )
  }
}
