/**
 * Append-Only Audit Logging Service (Client-Safe)
 *
 * EU AI Act Article 12 compliance: every AI transaction is logged with the
 * 14-field Minimum Viable Audit Schema. This service enforces:
 *   - Append-only: writes go through /api/audit (no direct Prisma import)
 *   - Contemporaneous: timestampUTC set at write time (server-side)
 *   - Attributable: userId tracks the actor
 *   - Real-time: logging at inference time (inputs + outputs)
 *
 * Override actions (human rejects/tweaks) create a NEW audit record
 * referencing the original via `overrideOf`.
 *
 * NOTE: This module is imported by client-side code (resolver.ts, ResolutionActions).
 * All Prisma operations are in /api/audit/route.ts (server-only).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditEventParams {
  resolutionId?: string
  userId?: string
  modelName: string
  modelVersion: string
  promptVersion: string
  promptHash: string
  queryClassification: string
  sourceDocuments: string
  confidenceScore: number | null
  responseId: string
  outputType: string
  regulatoryContext?: string
  approvalStatus?: string
  dataRetentionDays?: number
  graphNodesUsed?: string
  overrideOf?: string
  overrideReason?: string
}

export type ApprovalStatus =
  | 'PENDING_REVIEW'
  | 'APPROVED_HUMAN'
  | 'APPROVED_AUTO'
  | 'REJECTED_HUMAN'
  | 'MODIFIED_HUMAN'

// ---------------------------------------------------------------------------
// Visitor identity
// ---------------------------------------------------------------------------

const VISITOR_ID_KEY = 'intent-ide-visitor-id'

/**
 * Stable anonymous ID for this browser. On the shared public deployment it
 * scopes each visitor's audit trail to them (GET /api/audit filters on it).
 */
export function getVisitorId(): string {
  if (typeof localStorage === 'undefined') return 'local'
  try {
    let id = localStorage.getItem(VISITOR_ID_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(VISITOR_ID_KEY, id)
    }
    return id
  } catch {
    return 'local'
  }
}

// ---------------------------------------------------------------------------
// Core: Append-only write via API route
// ---------------------------------------------------------------------------

/**
 * Write a single audit record via /api/audit.
 * Fire-and-forget safe: errors are logged but never thrown.
 */
export async function logAuditEvent(params: AuditEventParams): Promise<string | null> {
  try {
    const response = await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'log', ...params, userId: params.userId ?? getVisitorId() }),
    })

    if (!response.ok) {
      console.error('[AuditLogger] API error:', response.statusText)
      return null
    }

    const data = await response.json()
    return data.id ?? null
  } catch (err) {
    console.error('[AuditLogger] Failed to write audit record:', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Convenience: Resolution audit
// ---------------------------------------------------------------------------

/**
 * Log an audit entry for a resolution event (after LLM inference).
 * Called from resolver.ts after producing a resolution.
 */
export async function logResolutionAudit(params: {
  resolutionId?: string
  annotationType: string
  transcript: string
  modelName: string
  modelVersion: string
  promptVersion: string
  responseId: string
  sourceDocuments?: string[]
  confidenceScore?: number | null
  graphNodesUsed?: string[]
  usedMADS?: boolean
}): Promise<string | null> {
  return logAuditEvent({
    resolutionId: params.resolutionId,
    modelName: params.modelName,
    modelVersion: params.modelVersion,
    promptVersion: params.promptVersion,
    promptHash: simpleHash(params.promptVersion + params.transcript.slice(0, 200)),
    queryClassification: params.annotationType.toUpperCase(),
    sourceDocuments: JSON.stringify(params.sourceDocuments ?? []),
    confidenceScore: params.confidenceScore ?? null,
    responseId: params.responseId,
    outputType: params.usedMADS ? 'MADS_DEBATE' : 'RESOLUTION',
    graphNodesUsed: JSON.stringify(params.graphNodesUsed ?? []),
  })
}

// ---------------------------------------------------------------------------
// Convenience: Override audit (human accepts/rejects/tweaks)
// ---------------------------------------------------------------------------

/**
 * Record a human oversight action. Creates a NEW audit record referencing
 * the original via `overrideOf`. Never mutates the original record.
 */
export async function logOverrideAudit(params: {
  originalAuditId: string
  newStatus: ApprovalStatus
  reason?: string
  userId?: string
}): Promise<string | null> {
  return logAuditEvent({
    modelName: 'human',
    modelVersion: 'human',
    promptVersion: 'N/A',
    promptHash: 'N/A',
    queryClassification: 'HUMAN_OVERRIDE',
    sourceDocuments: '[]',
    confidenceScore: null,
    responseId: crypto.randomUUID(),
    outputType: 'OVERRIDE',
    approvalStatus: params.newStatus,
    overrideOf: params.originalAuditId,
    overrideReason: params.reason ?? '',
    userId: params.userId,
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple non-cryptographic hash for prompt fingerprinting */
function simpleHash(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  return Math.abs(hash).toString(36)
}
