/**
 * Shared Prisma `select` shape for DocInvariant reads, used by both
 * /api/invariants and /api/invariants/resolve. Pulled out of route.ts
 * because Next.js App Router route files may only export route handlers
 * (GET/POST/etc.) and a small fixed set of config fields — any other named
 * export fails the build's route-type check.
 */
export const INVARIANT_SELECT = {
  id: true,
  documentId: true,
  statement: true,
  blockIds: true,
  checkKind: true,
  status: true,
  provenanceCommitHash: true,
  supersedesId: true,
  createdAt: true,
} as const
