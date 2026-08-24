/**
 * Which audit-ledger record ids a version commit should carry at apply time.
 *
 * `logResolutionAudit` (see `src/lib/ai/resolver.ts`) is fire-and-forget: the
 * apply path never awaits it, so at the moment a version commit is created
 * the write may be pending, failed, or already settled with an id. This
 * function is pure so that "pending write -> zero ids at apply time" (the
 * documented gap in `docs/compliance.md`) is a locked-in, tested outcome
 * rather than an accident of call order. A write that settles AFTER the
 * version already exists is not backfilled — see compliance.md.
 */
export function resolveApplyAuditIds(
  changeSetAuditRecordIds: string[] | undefined,
  resolutionAuditId: string | undefined,
): string[] {
  if (changeSetAuditRecordIds && changeSetAuditRecordIds.length > 0) {
    return changeSetAuditRecordIds
  }
  return resolutionAuditId ? [resolutionAuditId] : []
}
