import { describe, expect, it } from 'vitest'
import { resolveApplyAuditIds } from '../applyAuditLinkage'

describe('resolveApplyAuditIds', () => {
  it('prefers the change set audit record ids when present', () => {
    expect(resolveApplyAuditIds(['audit-1', 'audit-2'], 'audit-3')).toEqual(['audit-1', 'audit-2'])
  })

  it('falls back to the resolution audit id when the change set has none yet', () => {
    expect(resolveApplyAuditIds([], 'audit-3')).toEqual(['audit-3'])
    expect(resolveApplyAuditIds(undefined, 'audit-3')).toEqual(['audit-3'])
  })

  it('a settled resolution.auditId (write succeeded before apply) is captured', () => {
    expect(resolveApplyAuditIds(undefined, 'audit-late-but-settled')).toEqual(['audit-late-but-settled'])
  })

  it('a KNOWN-FAILED write and a STILL-IN-FLIGHT write both yield zero ids — documented gap, #83', () => {
    // resolution.auditId is undefined in both cases (a failed write never gets
    // one; a pending write hasn't received one yet) — this function has no
    // input that could distinguish them, so both collapse to the same empty
    // result. That collapse is the exact race #83 names: applying fast enough
    // that the fire-and-forget logResolutionAudit promise hasn't resolved
    // either way produces the same zero-audit-id version as an outright
    // failure, and neither is backfilled once/if the write later succeeds.
    // Locked in as documented behavior (docs/compliance.md), not a bug.
    expect(resolveApplyAuditIds(undefined, undefined)).toEqual([])
  })
})
