# EU AI Act Compliance — Document History & Human Oversight

Intent IDE keeps two linked, append-only records for every document: an immutable **version
history** (content-addressed snapshots) and an immutable **audit trail** (the 14-field
per-inference ledger). Together they satisfy the record-keeping and human-oversight duties of the
EU AI Act for a high-risk-style document workflow.

## Article 12 — Record-keeping

**Content-addressed, immutable versions.** Every version of a document is stored as a full
snapshot whose primary key is a sha256 hash of its canonical content, its parent version, and its
document id (`prisma/schema.prisma`, model `DocCommit`). Versions form an append-only linear chain
via parent pointers; restoring an old version creates a *new* version — history is never
rewritten or deleted.

**Server-side hash verification.** The only write path is `POST /api/history`
(`src/app/api/history/route.ts`), which recomputes the hash from the canonical payload
(`src/lib/history/canonical.ts`, shared verbatim by client and server) and rejects any mismatch.
A stored hash therefore proves the stored content: tampering with a snapshot is detectable, and
the API exposes no update or delete operations.

**Per-version attribution and linkage.** Each version records its kind (created / AI change /
edit session / restore), actor (`human` or `ai+human`), the model version in use for AI changes,
the annotation that produced it, the document blocks it touched ("last changed by"), and the ids
of the audit records covering the underlying AI inference — a direct join between the version
history and the Article 12 audit ledger (`AuditLog`, written via the append-only
`src/app/api/audit/route.ts` / `src/lib/audit/auditLogger.ts`).

**Retention.** Audit records carry a `dataRetentionDays` default of 2555 days (7 years); document
versions are retained indefinitely alongside them in the same SQLite database. Version capture
happens contemporaneously with the action that produced it (document creation, approved AI apply,
autosaved edit session, restore) — see `src/lib/history/commits.ts` and the capture points in
`src/stores/documentStore.ts`, `src/components/Annotations/ResolutionActions.tsx`, and
`src/components/Editor/EditorShell.tsx`.

## Article 14 — Human oversight

**No AI change reaches the document without a human gate.** AI-proposed edits are reviewed in the
Semantic Commit modal (per-change accept/reject) and every AI output defaults to
`PENDING_REVIEW`; human decisions are recorded as new override audit records
(`src/lib/audit/approvalGate.ts`), never as mutations of the original.

**Restores are explicit human actions.** Restoring a version is only reachable through a
confirmation gate in the History panel (`src/components/History/HistoryPanel.tsx`). Each restore
(1) creates a new version whose parent is the pre-restore head, so the full decision trail is
preserved, and (2) writes a `HUMAN_RESTORE` / `APPROVED_HUMAN` oversight record to the audit
ledger (`restoreCommit` in `src/lib/history/commits.ts`).

**Transparency in the product.** The History panel presents the chain in plain language
(Version / Compare / Restore / "Last changed by"), shows which versions carry audit records, and
states that history is immutable and linked to the audit trail.

## Reference

| Concern | Location |
| :--- | :--- |
| Version schema (append-only) | `prisma/schema.prisma` (`DocCommit`) |
| Append-only version API + hash verification | `src/app/api/history/route.ts` |
| Canonical hashing (shared client/server) | `src/lib/history/canonical.ts` |
| Version capture, blame, gated restore | `src/lib/history/commits.ts` |
| Audit ledger (14-field schema) | `prisma/schema.prisma` (`AuditLog`), `src/app/api/audit/route.ts` |
| Human oversight gates | `src/lib/audit/approvalGate.ts`, `src/components/ui/Confirmation.tsx` |
| History UI | `src/components/History/HistoryPanel.tsx` |
| Audit-layer design spec | `docs/specs/compliance-audit-layer.md` |
