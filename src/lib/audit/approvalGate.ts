/**
 * Human Oversight Controls — EU AI Act Article 14
 *
 * Every AI-generated output defaults to PENDING_REVIEW.
 * When a user accepts, rejects, or tweaks a resolution, this module
 * creates a new audit record documenting the human decision.
 *
 * The system must NEVER auto-apply global document changes.
 */

import { logOverrideAudit, type ApprovalStatus } from './auditLogger'

// ---------------------------------------------------------------------------
// Approval Gate
// ---------------------------------------------------------------------------

/**
 * Record that a human has reviewed an AI output and made a decision.
 * Creates a new append-only audit entry linked to the original.
 *
 * @param originalAuditId - The audit ID of the AI-generated output
 * @param action - The human's decision
 * @param reason - Optional: why the human made this decision
 * @returns The new override audit entry ID, or null on failure
 */
export async function recordHumanDecision(
  originalAuditId: string,
  action: 'approve' | 'reject' | 'modify',
  reason?: string,
): Promise<string | null> {
  const statusMap: Record<string, ApprovalStatus> = {
    approve: 'APPROVED_HUMAN',
    reject: 'REJECTED_HUMAN',
    modify: 'MODIFIED_HUMAN',
  }

  return logOverrideAudit({
    originalAuditId,
    newStatus: statusMap[action],
    reason,
  })
}

/**
 * Map a resolution action handler name to a human oversight action.
 * Used by ResolutionActions to determine which approval status to log.
 */
export function handlerToApprovalAction(
  handler: string,
): 'approve' | 'reject' | 'modify' | null {
  switch (handler) {
    case 'apply-edit':
    case 'add-to-doc':
    case 'act-on-thought':
    case 'change-from-answer':
    case 'park':
      return 'approve'
    case 'dismiss':
      return 'reject'
    case 'tweak':
    case 'explore':
    case 'explore-deeper':
    case 'research':
    case 'show-cascade':
      return 'modify'
    default:
      return null
  }
}
