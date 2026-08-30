/**
 * Fallback `documentId` stamped onto a persisted annotation/change record that
 * predates multi-document support (Phase 8, 2026-03-16) and so was never
 * given one.
 *
 * Pre-Phase-8 records carry no stored foreign key to a document/project id,
 * but they DO carry quoted document text (`Annotation.anchor.text`,
 * `ChangeEntry.beforeSlice`/`afterSlice`) that could in principle be matched
 * against the legacy document bodies `documentStore.ts`'s
 * `runLegacyProjectMigration` already recovers under their real ids, to
 * un-merge which of N pre-Phase-8 documents a record came from. This was
 * deliberately not attempted: `documentStore`, `annotationStore`, and
 * `changesStore` are three independent Zustand `persist` instances with no
 * guaranteed rehydration order, so a content-match migration would need to
 * defer until all three have hydrated — real added complexity — to
 * disambiguate matches that are themselves unreliable (duplicate or
 * near-duplicate phrasing across a user's own legacy documents is exactly
 * the kind of text a match would collide on), for what is likely a small
 * number of pre-2026-03-16 users. Judged not worth it; a true per-record
 * un-merge is left undone rather than shipped fragile.
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
 * Disclosed trade-off: because no real document is ever created with this
 * id, every record migrated onto it becomes permanently invisible to every
 * `documentId === activeDocumentId` filtered view (AnnotationPanel.tsx,
 * ChangesPanel.tsx, StatusBar.tsx, AnnotationMap.tsx, FloatingAnswer.tsx) —
 * there is no UI path to view, manage, or delete these records, unlike the
 * pre-fix behavior where they were wrongly but visibly attached to a real
 * document. This is intentional (the alternative is silent contamination of
 * live data, judged worse), not a bug, and is bounded by the existing
 * `MAX_PERSISTED_ANNOTATIONS`/`MAX_PERSISTED_ENTRIES`/
 * `MAX_PERSISTED_CHANGE_SETS` FIFO caps each store already applies to its
 * whole persisted array — orphaned records eventually age out via the same
 * mechanism as any other record, they do not grow unbounded. A UI affordance
 * to reach this bucket is out of #128's scope; filed as a follow-up.
 *
 * Shared by `annotationStore.ts`'s `migrateAnnotations` and
 * `changesStore.ts`'s `migrateChanges` so the two migrations cannot diverge.
 */
export const LEGACY_DOCUMENT_ID = 'legacy'
