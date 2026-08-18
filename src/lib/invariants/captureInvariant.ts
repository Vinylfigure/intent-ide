/**
 * Client-side capture for the Document Invariant Ledger — Phase 1 (data
 * model + capture only, issue #26). A user-declared fact ("terminations are
 * now 30 days"), recorded at SemanticCommitModal confirm time and linked to
 * the block(s) that evidence it, plus the DocCommit hash of the version that
 * declared it (provenance).
 *
 * The check runner that regression-tests these against later document edits,
 * and CascadeList surfacing of a failing invariant, are a separate follow-up
 * task (#20 steps 2-3) — this module only writes and reads the ledger.
 */

export type InvariantCheckKind = 'deterministic' | 'entailment'

export interface Invariant {
  id: string
  documentId: string
  statement: string
  blockIds: string // JSON string[] — evidence links
  checkKind: InvariantCheckKind
  status: string
  provenanceCommitHash: string | null
  createdAt: string
}

export interface CaptureInvariantParams {
  documentId: string
  statement: string
  blockIds?: string[]
  checkKind?: InvariantCheckKind
  provenanceCommitHash?: string | null
}

/**
 * Append one declared fact to the ledger. Throws on failure — UI paths that
 * must never block should use `recordInvariant` instead.
 */
export async function captureInvariant(params: CaptureInvariantParams): Promise<Invariant> {
  const res = await fetch('/api/invariants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      documentId: params.documentId,
      statement: params.statement,
      blockIds: params.blockIds ?? [],
      checkKind: params.checkKind ?? 'deterministic',
      provenanceCommitHash: params.provenanceCommitHash ?? undefined,
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error ?? `Failed to capture invariant (HTTP ${res.status})`)
  }
  const data = await res.json()
  return data.invariant
}

/**
 * Fire-and-forget wrapper for UI paths (mirrors `recordCommit`): never
 * throws, never blocks the apply flow. Server-side renders and non-browser
 * test environments are a silent no-op.
 */
export function recordInvariant(params: CaptureInvariantParams): void {
  if (typeof window === 'undefined') return
  captureInvariant(params).catch((err) => {
    console.warn('[invariants] Failed to capture invariant:', err)
  })
}

/** All invariants declared for a document, newest first. */
export async function listInvariants(documentId: string): Promise<Invariant[]> {
  const res = await fetch(`/api/invariants?documentId=${encodeURIComponent(documentId)}`)
  if (!res.ok) throw new Error(`Failed to load invariants (HTTP ${res.status})`)
  const data = await res.json()
  return data.invariants ?? []
}
