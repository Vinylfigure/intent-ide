/**
 * Fallback `documentId` stamped onto a persisted annotation/change record that
 * predates multi-document support (Phase 8, 2026-03-16) and so was never
 * given one. Pre-Phase-8 records carry no field — no project/document id, no
 * anchor that survives across documents — that ties them back to which
 * single-document session they came from, so a true per-record un-merge is
 * not possible from the data alone: this is a deliberate, disclosed limit,
 * not a gap to close later.
 *
 * Given that, the fallback MUST be one fixed placeholder rather than
 * `useDocumentStore`'s current `activeDocumentId` — reusing whatever document
 * happens to be open at the moment migration runs would silently splice a
 * stranger's legacy history onto it. A fixed placeholder can still merge
 * multiple distinct pre-Phase-8 sessions' records together (unavoidable
 * without a source id), but it can never bleed into a real, currently-open
 * document, and a document actually created with this id is exactly as
 * unlikely as any other generateId() collision.
 *
 * Shared by `annotationStore.ts`'s `migrateAnnotations` and
 * `changesStore.ts`'s `migrateChanges` so the two migrations cannot diverge.
 */
export const LEGACY_DOCUMENT_ID = 'legacy'
