# EU AI Act Compliance — Document History & Human Oversight

Intent IDE keeps two linked, append-only records for every document: a **version history**
(content-addressed snapshots) and an **audit trail** (the 14-field per-inference ledger).
Together they support the record-keeping and human-oversight duties of the EU AI Act for a
high-risk-style document workflow.

This document states precisely what the system enforces and how — including the boundaries of
those guarantees. Precision over promotion.

## Article 12 — Record-keeping

**Append-only, enforced at the application layer.** The only write path is
`POST /api/history` (`src/app/api/history/route.ts`); the API exposes no update or delete
operations, and restores are recorded as *new* versions — history is never rewritten through the
application. This is an application-level guarantee, not a physical one: an actor with direct
access to the local SQLite file could remove or alter rows. Hash verification (below) makes such
partial modification *detectable* (tamper-evident), not impossible.

**Two-level content addressing (git's design).** Every version stores a `contentHash` — sha256
over the canonical document content only — and is keyed by a commit `hash` — sha256 over the
canonical join of document id, parent version, content hash, kind, message, actor, annotation id,
audit-record ids, and model version (`src/lib/history/canonical.ts`, shared verbatim by client
and server). Because the commit hash covers attribution as well as content, two versions that
agree on content but differ in provenance (an applied AI change and a manual edit session, say)
are distinct records by construction and cannot be silently collapsed.

**Server-side hash verification.** The server recomputes both hashes from the submitted payload
and rejects either mismatch, so a stored hash always proves the stored content and its recorded
attribution against partial modification.

**A parent-linked chain, kept linear by the server.** Versions form a parent-pointer chain. The
server enforces linearity: one root per document and one child per parent; a write against a
stale head is rejected (HTTP 409) and the client rebases onto the new head and retries once.
History therefore cannot fork.

**Attribution is client-supplied.** This is a local-first, bring-your-own-key application with no
server-side authentication or signing. The attribution fields on a version (kind, actor, model
version, annotation id, audit ids) are recorded faithfully by the application code, and the hash
scheme prevents their after-the-fact modification — but they are asserted by the client at write
time, not cryptographically signed by an independent authority. They are attribution records, not
non-repudiable signatures.

**Linkage to the audit ledger — including the failure path.** Versions of kind `apply` carry the
ids of the audit records covering the underlying AI inference, a direct join to the Article 12
audit ledger (`AuditLog`, written via the append-only `src/app/api/audit/route.ts` /
`src/lib/audit/auditLogger.ts`). When an audit write fails at inference time, the resolution is
flagged in the UI (`auditFailed`) and the linked version records **zero** audit ids — the gap is
surfaced, not papered over.

**Retention.** Audit records carry a `dataRetentionDays` default of 2555 days (7 years); document
versions are retained indefinitely alongside them in the same SQLite database. Version capture
happens contemporaneously with the action that produced it (document creation, approved AI apply,
autosaved or flushed edit session, restore) — see `src/lib/history/commits.ts` and the capture
points in `src/stores/documentStore.ts`, `src/components/Annotations/ResolutionActions.tsx`, and
`src/components/Editor/EditorShell.tsx`.

## Article 14 — Human oversight

**No AI change reaches the document without a human gate.** AI-proposed edits are reviewed in the
Semantic Commit modal (per-change accept/reject) and every AI output defaults to
`PENDING_REVIEW`; human decisions are recorded as new override audit records
(`src/lib/audit/approvalGate.ts`), never as mutations of the original.

**Restores are explicit human actions, persisted before they take effect.** Restoring a version
is only reachable through a confirmation gate in the History panel
(`src/components/History/HistoryPanel.tsx`). Each restore, in order: (0) flushes any pending
unsaved edits as their own version, so restoring never discards recent typing from the record;
(1) writes a `HUMAN_RESTORE` / `APPROVED_HUMAN` oversight record to the audit ledger; (2) records
the new restore version carrying that audit record's id — a direct Article 12 link; and (3) only
after all records are safely written, changes the document on screen (`restoreCommit` in
`src/lib/history/commits.ts`). A failed write leaves the document untouched.

**Transparency in the product.** The History panel presents the chain in plain language
(Version / Compare / Restore / "Last changed by"), shows which versions carry audit records, and
describes the append-only guarantee in the same terms as this document.

## Reference

| Concern | Location |
| :--- | :--- |
| Version schema (append-only, two-level hashes) | `prisma/schema.prisma` (`DocCommit`) |
| Append-only version API + hash verification + linearity | `src/app/api/history/route.ts` |
| Canonical hashing (shared client/server) | `src/lib/history/canonical.ts` |
| Version capture, blame, gated restore | `src/lib/history/commits.ts` |
| Audit ledger (14-field schema) | `prisma/schema.prisma` (`AuditLog`), `src/app/api/audit/route.ts` |
| Audit-failure surfacing (`auditFailed`) | `src/lib/ai/resolver.ts`, `src/lib/annotations/types.ts` |
| Human oversight gates | `src/lib/audit/approvalGate.ts`, `src/components/ui/Confirmation.tsx` |
| History UI | `src/components/History/HistoryPanel.tsx` |
| Audit-layer design spec | `docs/specs/compliance-audit-layer.md` |
