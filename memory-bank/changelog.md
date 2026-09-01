# Changelog

All notable changes to the Intent IDE project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2026-08-30] PR #135 brought current with `main` after PRs #130/#131/#132 merged; PR #136 folded in by the operator

Housekeeping, not a feature entry. `main` advanced past PR #135's stacked base (PR #132's branch) once the operator merged PRs #130, #131, and #132 to `main`; GitHub retargeted #135's base to `main`, exposing a real `mergeable_state: dirty` — three `memory-bank/*.md` append-at-top conflicts only (same class PR #130 resolved for #125/#123), no source-code conflicts. Separately, the operator merged **PR #136** (closes #134) directly into PR #135's branch rather than into `main`, so #135's diff now also carries #134's fix.

- Merged `origin/main` into `claude/legacy-data-ui` with a merge commit (never a rebase — the branch already carries the operator's own merge commit from landing #136, so history was not rewritten).
- Resolved all three memory-bank conflicts by concatenating both sides' entries in true chronological order, dropping nothing from either parallel firing.
- Re-ran `npm run typecheck` / `npm run lint` / `npm run test` on the merged tree before pushing.
- Updated PR #135's body to also say "Closes #134", since #136's commits are now part of its diff.

## [2026-08-29] `changesStore` wiring for document delete — fix delivered, PR #136 MERGED into PR #135's branch (not `main`) by the operator, 2026-08-29 → 2026-08-30

Closes issue #134 (task: label, filed 2026-08-28, `discovered-from: work-loop adversarial review of the PR for #133, 2026-08-28`). `DocumentHubSidebar.tsx`'s `handleDeleteDocument` called `useAnnotationStore.getState().removeByDocumentId(documentId)` (fixed for annotations by #107/PR #106) but never called the `changesStore` equivalent, because until PR #135 `changesStore.ts` had no `removeByDocumentId` action at all. #135 added that action (for #133); #134's scope was purely wiring it into the document-delete handler. **PR #136's base branch is `claude/legacy-data-ui` (PR #135's branch), not `main`** — the `removeByDocumentId` action it depends on doesn't exist on `main` yet.

### Fixed
- **`src/components/Layout/DocumentHubSidebar.tsx`:** added `import { useChangesStore } from '@/stores/changesStore'`; `handleDeleteDocument` now also calls `useChangesStore.getState().removeByDocumentId(documentId)`, right after the existing `useAnnotationStore` call and before `deleteDocument(documentId)`.

### Process
- Adversarial (troublemaker) review verdict: **MERGE**, no blocking findings. Independently reproduced typecheck/lint/test and the mutation test (stashed the fix, confirmed the new test fails with the `e-1` entry surviving deletion; restored, confirmed green). Independently re-verified that `deleteCollection` (`documentStore.ts`) has no analogous gap — it never cascade-deletes member documents, only strips `collectionIds` — by reading the function directly. Grepped repo-wide for `deleteDocument(` — `DocumentHubSidebar.tsx` is the only call site; both its `onDelete` entry points (all-documents row, expanded-collection row) funnel through the same `handleDeleteDocument`, so one test covers both.
- **One LOW, disclosed, not fixed, pre-existing from #135 (not this diff):** `changesStore.removeByDocumentId` doesn't touch `snapshots` (`VersionSnapshot` has no `documentId` field) — mitigated since snapshots are never persisted (`onRehydrateStorage` always resets to `[]`), so it's an in-memory-only, session-bounded gap, not a storage leak. Not filed as a new issue.
- New test file `src/components/Layout/__tests__/documentHubSidebar.deleteClearsChanges.test.tsx` (2 tests): deleting a document via the UI confirmation flow removes only that document's `changesStore` entries/changeSets, others untouched; cancelling leaves `changesStore` untouched.
- `npm run typecheck` clean, `npm run lint` clean, `npm run test` — **1139 passing + 10 skipped** (up from 1137 on PR #135's branch; +2 new tests).

**PR #136 (branch `claude/changesstore-delete-wiring`, https://github.com/Vinylfigure/intent-ide/pull/136, base `claude/legacy-data-ui`) MERGED** — confirmed via the GitHub API: `merged: true`, `merged_by: Vinylfigure`, merge commit `f2196d7`. Merged into PR #135's branch rather than `main` directly, so #134's fix reaches `main` only once #135 itself merges (see the entry above).

Closes #134 (reaches `main` once #135 merges).

**Also for continuity, not actioned this firing:** as of this firing's ready-sweep, four other open PRs exist, all green CI, all `mergeable_state: clean` except one: PR #135 (closes #133, stacked on #132), PR #132 (closes #128, base `main`), PR #131 (closes #127, base `main`), PR #130 (closes #122, base `main`, supersedes and should replace #125 which is now `mergeable_state: dirty` — #130's own body says close #125 without merging once #130 lands). None had red checks, so per the work-loop skill's priority rule they didn't outrank starting new work on #134.

## [2026-08-28] Legacy-data view/manage/purge UI for the `LEGACY_DOCUMENT_ID` bucket — fix delivered, PR #135 open (base retargeted to `main` 2026-08-30 after PR #132 merged)

Closes issue #133 ("no UI path to view/manage/purge the LEGACY_DOCUMENT_ID migration bucket"), filed as a follow-up from PR #132's own adversarial review. **PR #135's base branch is `claude/legacy-documentid-migration-fallback` (PR #132's branch), not `main`** — #133's fix depends on `src/lib/documents/legacyDocumentId.ts`, which PR #132 introduces and which does not exist on `main` yet.

### Added
- **`changesStore.ts` gains `removeByDocumentId(documentId)`** (filters `entries` + `changeSets`), mirroring `annotationStore.ts`'s existing action of the same name — `changesStore` had no equivalent before this PR.
- **New "Legacy data" section in `ApiKeyModal.tsx`'s API Configuration modal**, shown only when non-empty: counts of `LEGACY_DOCUMENT_ID`-scoped annotations/change-sets/changes, and a "Clear legacy data" button wired to both stores' `removeByDocumentId(LEGACY_DOCUMENT_ID)`.

### Decided against
- **Did not make `LEGACY_DOCUMENT_ID` selectable as `activeDocumentId`** — the issue's other suggested approach. Verified via `EditorShell.tsx` that new annotations/changes are stamped `documentId: activeDocumentId` at creation time, so making the placeholder "active" would let new records leak into the bucket — a new contamination vector into the exact thing PR #132 just closed off. A dedicated settings-panel view/clear affordance was used instead.

### Process
- Adversarial (troublemaker) review verdict: **MERGE**, no blocking findings.
- **MEDIUM, disclosed not fixed:** "Clear legacy data" has no confirmation gate and is irreversible, foreclosing a hypothetical future content-matching un-merge recovery path `legacyDocumentId.ts`'s own doc comment describes as "left undone" (not abandoned). Judged acceptable — CLAUDE.md's HITL mandate is scoped to "global document changes"; this is orphaned metadata attached to no real, visible document, unlike `DocumentHubSidebar`'s Confirmation-gated document/collection delete. Precedent: this same modal already has an unguarded irreversible "Reset" button for calibration stats.
- **LOW, moot:** `removeByDocumentId` doesn't touch `snapshots` (no `documentId` field) — confirmed `createSnapshot()` has zero production call sites anywhere in `src/`, dead code today.
- **LOW, pre-existing, confirmed, NOT fixed here, filed as follow-up issue #134:** `DocumentHubSidebar.tsx`'s real document-delete handler only calls `useAnnotationStore.getState().removeByDocumentId`, never a `useChangesStore` equivalent (which didn't exist until this PR added it) — so deleting a real document has always silently orphaned that document's changesStore entries/changeSets, independent of this PR (`discovered-from: work-loop adversarial review of the PR for #133, 2026-08-28`).
- **LOW, cosmetic, not blocking:** since the section renders on the sum of three counts, an individual count can read "0" in the rendered sentence.
- New test files: `src/stores/__tests__/changesStore.removeByDocumentId.test.ts` (2 tests), `src/components/Settings/__tests__/apiKeyModal.legacyData.test.tsx` (3 tests) — both mutation-tested (fail against reverted production code).
- `npm run typecheck` clean, `npm run lint` clean, `npm run test` — **1137 passing + 10 skipped** on the PR branch (up from 1132 on PR #132's branch, the merge base).

**PR #135 (branch `claude/legacy-data-ui`) is OPEN.** PR #132 merged to `main` 2026-08-30; GitHub retargeted #135's base to `main`, exposing a memory-bank-only merge conflict resolved in the entry at the top of this file. #135 now also carries PR #136's fix (closes #134), merged into its branch by the operator — see above.

Closes #133, #134 (on merge).

**Also for continuity, not actioned this session:** as of this sweep, three PRs besides #135 are open, all green CI / clean `mergeable_state`, all awaiting operator review/merge: PR #130 (closes #122, supersedes and should replace #125 which went dirty), PR #131 (closes #127, docGraph inflight capability keying), PR #132 (closes #128, legacy documentId migration fallback — PR #135 above stacks on it). PR #125 is superseded by #130 and should be closed (not merged) once #130 lands — operator's call, not actioned by this firing. Issue #134 (filed above) is not yet consumed.

## [2026-08-28] `getDocGraph` inflight-dedupe capability mismatch — fix delivered, PR #131 MERGED (2026-08-30, confirmed via the merge-conflict resolution entry at the top of this file)

Closes issue #127, filed 2026-08-27 as a work-loop idle-evaluation proposal and named as a known pre-existing debt in the Cascade v2 roadmap close-out (`raw_reflection_log.md`/`progress.md` "Inflight-dedupe race" carry-forward line) but never fixed until now.

### Fixed
- **`getDocGraph`'s inflight dedupe could hand a concurrent caller a lower-capability graph than it asked for.** `src/lib/graphrag/docGraph.ts` deduped concurrent builds for the same document content-hash via an `inflight` map keyed only on the hash. `scheduleDocGraphRebuild` calls it on every debounced edit with `skipLlm`/`skipEmbeddings`/`skipGraphiti` all true (deliberate deterministic-only background build — document text must never leave the machine as a side effect of typing). If a user-initiated cascade wanting the fuller LLM/embeddings/graphiti-augmented graph called `getDocGraph` for the same hash while that background build was still in-flight, it silently got handed the SAME promise — resolving to the deterministic-only graph, with no error or signal it was missing the augmentation it explicitly asked for.
- **Fix (option (b) from #127's own stated acceptable approaches):** `inflight` entries now carry the capability set (`{llm, embeddings, graphiti}`) they'll deliver. A caller whose wanted capabilities aren't covered by an in-flight entry chains a "continuation": it awaits the same `DocGraph` object, then runs only the still-missing passes against it (`applyRequestedPasses`, extracted from the old build body) before re-caching/re-publishing, using the SAME shared mutable graph object (no duplicate-object cache-clobber race). A third caller wanting even more chains onto that continuation. Concurrent callers requesting the same (or a subset of) capabilities still dedupe to one build, unchanged.

### Process
- Two rounds of pre-push adversarial (troublemaker) review, both NO-MERGE with a blocking, empirically-reproduced finding, both fixed with regression tests before the PR was opened. **Round 1:** the first fix folded `llmAvailable(config)` into the single flag driving both cache/inflight bookkeeping AND whether `applyRequestedPasses` entered the LLM branch — but that branch also carries forward previously-cached LLM edges for UNCHANGED blocks (`findBestPriorGraph`/`carryForwardLlmEdges`), which the ORIGINAL pre-#127 code ran whenever the caller didn't pass `skipLlm`, independent of live-call availability. Folding availability in meant a dropped/invalid API key would silently ERASE previously-found LLM edges for content the triggering edit never touched — reproduced concretely (valid-key build finds an edge; key goes invalid; unrelated-block edit; edge vanishes on the broken version, survives on origin/main). Fixed by splitting `llmRequested = !deps.skipLlm` (raw caller intent, gates the carry-forward branch) from `llmWanted = llmRequested && llmAvailable(config)` (availability-aware, used only for the cache-hit check). **Round 2:** round 1's split only applied at the single-call `wanted` object — the multi-caller `covers` check and `InflightEntry` bookkeeping still compared availability-gated `llmWanted` on both sides, so two concurrently-unavailable callers with different RAW intent (one skips llm, one doesn't) could still silently inherit each other's result — the same bug shape as #127 itself, one layer down. Confirmed dormant in production today only because every current call site happens to couple `skipLlm` with `skipGraphiti`/`skipEmbeddings` (an unenforced, undocumented cross-file invariant across `scheduleDocGraphRebuild`, `directEditTrigger.ts`, `entailmentCheck.ts`; `proposeCascadeEdits` never skips either, which happens to force the covers-check false against every background caller anyway). Fixed by using `llmRequested` consistently through `InflightEntry.llm`, the `covers` comparison, and both entry-construction sites. Both findings were mutation-tested directly (temporarily reverted the specific fix, confirmed the exact predicted regression test failure, restored the fix) — not merely argued from reading the diff.
- A third, self-identified (not reviewer-flagged) gap was also closed before push: round 2's own summary claimed a test covered "orthogonal capability requests serializing rather than parallelizing" (a disclosed, accepted, non-blocking design trade-off — one of #127's own stated acceptable approaches, not a regression) — that claim was inaccurate; the cited test only exercised a SUBSET scenario (dedupe short-circuit), never two genuinely DISJOINT requests (e.g. llm-only vs embeddings-only). A new test closes the gap, proving chained continuations still deliver BOTH requested capabilities.
- 6 new tests in `src/lib/graphrag/__tests__/docGraph.test.ts`: (1) the original race repro (background deterministic-only build in-flight, concurrent cascade wanting LLM gets `llmApplied: true` and its edge, not silently dropped); (2) a subset caller dedupes onto an in-flight fuller build with no redundant model call; (3) the exact production call shapes of `scheduleDocGraphRebuild` and `proposeCascadeEdits` (which hit the un-stubbed `embeddingsEnabledFromStore()` await before either call reaches the inflight check); (4) round 1's regression (LLM edges carry forward across an untouched block even when the provider becomes unavailable on a later build); (5) round 2's regression (a concurrent caller wanting LLM carry-forward is never satisfied by an in-flight build that skipped it, even when both callers are currently unavailable); (6) disjoint capabilities (llm-only vs embeddings-only) both end up delivered via chaining, not lost.
- `npm run typecheck` clean, `npm run lint` clean, `npm run test` — 1126 passing + 10 skipped (up from 1120 on `main` at merge base `2f388a9`; +6 new tests, nothing else regressed).
- No new follow-up issues filed — the one disclosed known limitation (chained continuations serialize rather than parallelize disjoint capability requests) was closed with a regression test rather than deferred, and is explicitly within #127's own stated scope, not a descoped remainder.

**PR #131 (branch `claude/docgraph-inflight-capability`, https://github.com/Vinylfigure/intent-ide/pull/131, body "Closes #127") MERGED to `main`** — confirmed via the merge-conflict resolution entry at the top of this file (2026-08-30).

Closes #127.

**Also for continuity, not actioned this session:** at the start of this session, **PR #123** (closes #117) and **PR #124** (closes #121) — both logged below as "open" — had since **merged**; issue #122 (the `loadDoc()` outgoing-autosave-flush data-loss bug PR #123 disclosed but didn't fix) gained an open **PR #125**, which went stale (`mergeable_state: dirty`) after #123/#124 merged and was superseded by **PR #130** ("Rebase #125 onto main after #123 merged", also closes #122, `mergeable_state: clean`, CI green) — both #125 and #130 are still open, untouched this session (their own CI is green). **PR #129** (closes #126, `changesStore` documentId migration mirroring `annotationStore`'s) merged before this session started. New issue **#128** was filed by the repo owner (not this session) about a migration-fallback data-integrity gap in `migrateAnnotations`/`migrateChanges`, discovered from PR #129's own adversarial review — still open, not evaluated this session since #127 was chosen first as the older ready task.

## [2026-08-27 → merged 2026-08-28] StatusBar "N thinking…" chip scoped to active document — fix delivered, PR #124 MERGED

Closes issue #121, filed as a follow-up from PR #120's own adversarial review (`discovered-from: work-loop adversarial review of PR #120 for #116, 2026-08-27`).

### Fixed
- **`StatusBar.tsx`'s `inFlightCount` selector (the "N thinking…" chip)** now filters on `a.documentId === activeDocumentId`, matching the other three chips in the same component (`annotationCount`, `changeSetCount`, `changeCount`) that PR #120/#116 already scoped. Previously counted in-flight (`pending`/`classified`/`resolving`) annotations across every document, so it could show "N thinking…" for unrelated background work on a document other than the one the user was viewing.

### Process
- Adversarial (troublemaker) review verdict: **MERGE**. Confirmed by repo-wide grep that no other place duplicates the `pending|classified|resolving` in-flight filter: `annotationStore.ts`'s `finalizeInterruptedAnnotations` uses the same status trio but for rehydration repair, not a display count (correctly out of scope); `DocumentHubSidebar.tsx`'s delete-confirmation count is an unrelated, intentionally different per-target-document filter. Every new test assertion was traced against the pre-fix filter and confirmed to fail on revert (not vacuous).
- One minor, non-blocking coverage-parity nit raised and closed before push: the sibling #116 test file (`statusBar.activeDocumentScope.test.tsx`) has an explicit `activeDocumentId === null` case this file initially lacked; `documentId` is typed non-nullable `string` and `annotationStore.ts`'s `migrateAnnotations` unconditionally backfills a nullish `documentId` on hydration, so this was a coverage gap rather than an exploitable bug — the null-active-document test case was added before push.
- `npm run test` — 1111 passing + 10 skipped on the PR branch (1110 on `main` at merge base `dcfbee4`, the commit that merged PR #120). `npm run typecheck` / `npm run lint` clean. New test file `src/components/Layout/__tests__/statusBar.inFlightScope.test.tsx` (4 tests).
- No new follow-up issues filed — the fix was fully scoped to #121's done-means with no descoped remainder.

**PR #124 (branch `claude/statusbar-inflight-scope`, https://github.com/Vinylfigure/intent-ide/pull/124, body "Closes #121") MERGED to `main` — confirmed merged as of the PR #131 session (2026-08-28).**

Closes #121.

**Also for continuity, not actioned this session:** between the last memory-bank update (below) and this session, PR #119 (closes #115, "Gate collection delete behind a confirmation step") and PR #120 (closes #116) both **merged**; issue #117 gained an open PR #123 (not yet merged — `mergeable_state` shows a merge conflict against `main` but CI checks are green, left for its own review/resolution); issue #122 was filed (discovered-from PR #123/#117's adversarial review), not yet consumed.

## [2026-08-27] StatusBar chip counts scoped to active document — fix delivered, PR #120 MERGED

## [2026-08-27] loadDoc() flushes outgoing dirty edit before document switch — fix delivered, PR #125 open (not yet merged)

Discovered as a by-product of adversarial review on PR #123 (fix for #117); filed as its own issue (#122) with its own done-means rather than folded in or left as a TODO.

### Fixed
- **`DocInputModal.tsx`'s `loadDoc()`** (shared by Blank/Paste/Generate/Import) now flushes the outgoing document's pending unsaved edit before replacing editor content and switching `activeDocumentId` — previously it did neither, unlike `EditorShell.tsx`'s own document-switch effect, which already guards against exactly this. Concretely: typing into Document A within the 5s autosave window, then creating/pasting/generating/importing a new document before the timer fires, silently dropped Doc A's edit (never written to localStorage, never recorded via `recordCommit`) — `loadDoc()`'s content-replace transaction re-armed the autosave debounce around the new document's content, destroying the timer that would have flushed Doc A, and `createDocument()` reset `isDirty: false` before `EditorShell`'s switch-effect guard could see it.
- **Fix:** `loadDoc()` reads `useDocumentStore.getState()` before dispatching the replace transaction; if the active document is dirty, it captures the current (pre-replace) editor content via `view.state.doc.toJSON()` and flushes it with `saveDocument()` + `recordCommit()` (kind: 'direct', actor: 'human') — mirroring `EditorShell.tsx`'s existing guard exactly. All four call sites funnel through this one fix.

### Process
- Adversarial (troublemaker agent) review verdict: **MERGE**. Confirmed the flush ordering has no stale-closure risk (`view.state.doc` is read before the replace transaction; `useDocumentStore.getState()` is read fresh at call time), and that the flush cannot recursively retrigger `EditorShell`'s autosave since it dispatches no transaction of its own. Confirmed `EditorShell`'s own switch effect does not double-flush (its guard correctly no-ops once `createDocument()` has already reset `isDirty`) and that its pre-existing redundant reload of the new document's content is not a regression introduced here.
- One real finding on the original test 2 (mutation-tested by the reviewer): it only asserted `loadDoc()` didn't throw when `isDirty` was false, which would pass identically even with a broken (`||` instead of `&&`) guard. Fixed before push by spying on `saveDocument` directly; self-mutation-tested afterward — weakened the guard to `||`, confirmed the tightened test now fails, restored the fix, confirmed it passes again.
- **Adjacent bug surfaced, not a new discovery:** the review independently found `loadDoc()`'s content-replace transaction is missing `tr.setMeta('addToHistory', false)`, risking an immediate Cmd-Z after a document switch resurrecting the outgoing document's content into a view still bound to the new document's id. This is exactly the bug already fixed on open PR #123 (`claude/loadDoc-undo-history-guard`, closes #117), which predates this branch — verified by diffing PR #123's branch directly rather than assumed. No new issue filed; the PR body notes this explicitly so nothing is silently dropped between the two open PRs.
- `npm run test` — 1109 passing + 10 skipped on the PR branch (1107 baseline on `main` at `dcfbee4`). `npm run typecheck` / `npm run lint` clean. New test file `src/components/DocInput/__tests__/docInputModal.flushOutgoingDirty.test.tsx`.

**PR #125 (branch `claude/loadDoc-flush-outgoing-dirty`, https://github.com/Vinylfigure/intent-ide/pull/125, base `main` at `dcfbee4`) is OPEN, not yet merged to `main` — awaiting operator review.**

Closes #122 (on merge).

## [2026-08-27] StatusBar chip counts scoped to active document — fix delivered, PR #120 open (not yet merged)

### Fixed
- **`StatusBar.tsx`'s annotation/change-set/change count chips** now filter by `documentId === activeDocumentId`, matching every other consumer of `annotationStore`/`changesStore` (`AnnotationPanel.tsx`, `ChangesPanel.tsx`). Previously read raw, unfiltered totals across all documents. Fixed by adding `activeDocumentId` from `useDocumentStore` and filtering all three chip counts by it.

### Process
- Adversarial (troublemaker) review verdict: **MERGE**. Mutation-tested — reverting only `StatusBar.tsx` makes all 3 new tests fail, confirming they aren't vacuous.
- Two findings surfaced, both non-blocking: **(1) medium** — `inFlightCount` (the "N thinking…" chip) remains unscoped across all documents, since `documentStore.setActiveDocument` has no side effects to pause background classification/resolution on document switch; deliberately out of #116's stated scope, filed as follow-up **issue #121**. **(2) low, pre-existing, not introduced by this PR** — `changesStore.ts` has no legacy-data migration for `entries`/`changeSets` analogous to `annotationStore.ts`'s `migrateAnnotations`, so a pre-multi-document persisted change record with a missing `documentId` silently vanishes from `ChangesPanel.tsx`'s and now `StatusBar.tsx`'s filtered views; predates this PR (same filter already existed in `ChangesPanel.tsx`), not filed as a separate GitHub issue.
- `npm run test` — 1103 passing + 10 skipped on the PR branch (1100 before this branch). `npm run typecheck` / `npm run lint` clean. New test file `src/components/Layout/__tests__/statusBar.activeDocumentScope.test.tsx`.

**PR #120 (branch `claude/statusbar-active-doc-scope`, https://github.com/Vinylfigure/intent-ide/pull/120, body "Closes #116") MERGED to `main` — confirmed merged as of the PR #124 session above (2026-08-27); PR #124 cites the merge commit `dcfbee4` as its merge base.**

Closes #116. Files #121 — fixed by PR #124 above.

## [2026-08-27 → merged 2026-08-28] `loadDoc()` undo-history guard — fix delivered, PR #123 MERGED

Consumes issue #117: `DocInputModal.tsx`'s `loadDoc()` (shared by Blank/Paste/Generate/Import) replaced the editor's full content via `replaceWith` without `tr.setMeta('addToHistory', false)`, unlike `EditorShell.tsx`'s already-guarded document-switch path — Cmd-Z after creating/loading a document could resurrect the prior document's content and, via the existing autosave debounce, get it written to localStorage under the new document's id (the same class of bug the v8.4 doc-switch fix closed for `EditorShell.tsx` on 2026-07-09, just at a second unguarded call site).

### Fixed
- **`loadDoc()`** now dispatches its content-replace transaction with `tr.setMeta('addToHistory', false)`, matching `EditorShell.tsx`'s guard. All four load paths (Blank/Paste/Generate/Import) funnel through this one function, so one fix closes all four.

### Process
- New regression test `src/components/DocInput/__tests__/docInputModal.loadDocHistoryGuard.test.tsx` mounts a real `EditorView` with the `history` plugin, drives the Paste flow, then calls `undo()` and asserts content is unchanged and `undo()` returns `false`. Mutation-tested: reverting only the fix reproduces the exact resurrection bug and fails the test.
- Adversarial (troublemaker) review confirmed the fix correct and complete for #117's stated scope, and grepped the codebase to confirm no other unguarded full-document-replace site exists anywhere — the only three full-document-replace sites are `EditorShell.tsx` (pre-existing, guarded), `src/lib/history/commits.ts` (pre-existing, guarded), and this one (now guarded). Also confirmed the new test is not vacuous — it distinguishes a truthy-but-not-`false` `addToHistory` value from a real fix, per prosemirror-history's own `!== false` check.
- **Separate pre-existing bug found and reproduced (not fixed here, deliberately descoped):** the same review independently reproduced, via a scripted repro with fake timers (not shipped), that `loadDoc()` never flushes the *outgoing* document's dirty autosave before replacing content and switching `activeDocumentId` — unlike `EditorShell.tsx`'s own switch effect, which flushes first. Failure chain: edit Doc A inside the 5s autosave debounce window → open `DocInputModal` and load Doc B → the load's `docChanged` transaction re-triggers `debouncedSave`, clearing Doc A's pending flush and rescheduling around the now-replaced Doc B content → `createDocument()` sets `activeDocumentId` to Doc B and resets `isDirty: false` → `EditorShell`'s flush-before-switch guard re-reads `isDirty` fresh, finds it already false, and no-ops → Doc A's edit is silently lost, never written to localStorage, never recorded via `recordCommit`. This is a silent DATA-LOSS bug (not corruption), independent of the addToHistory fix. Filed as its own issue, **#122**, with a stated done-means and repro chain (`discovered-from: work-loop adversarial review of the PR for #117, 2026-08-27`).
- `npm run typecheck` clean, `npm run lint` clean, `npm run test` — 1101 passing + 10 skipped (up from 1100 on `main`).

**PR #123 (branch `claude/loadDoc-undo-history-guard`, https://github.com/Vinylfigure/intent-ide/pull/123) MERGED to `main` — confirmed merged as of the PR #131 session (2026-08-28). PR body said "Closes #117" and honestly disclosed issue #122 as a known, separate, unfixed bug rather than folding it in or omitting it.**

Closes #117. Files #122 (still open — superseded by PR #130, see the PR #131 entry above).

## [2026-08-25] `heldAnswers` leak on annotation removal — fix delivered, PR #106 open (not yet merged)

Continues a `heldAnswers` leak-fix chain this changelog has no prior entries for (issue #95 → PR #102 → issue #103 → PR #106 → issue #107); #95/#102 predate this entry and are not detailed here.

### Fixed
- **`useAnnotationStore.remove(id)`** now also calls `useFlowStore.getState().revealAnswer(id)` to purge a matching `heldAnswers[id]` entry — a held answer for a removed annotation had no live poll and could otherwise never be revealed, leaking in `useFlowStore` for the rest of the session. `remove()` itself has zero production call sites (confirmed by repo-wide grep).
- **`useAnnotationStore.clear()`** — the actually-reachable production trigger (fires from `DocInputModal.tsx` on every New/Paste/Generate/Import document action) — now also calls a new `useFlowStore.clearHeldAnswers()` to drop every held answer atomically. This is the fix that closes the leak in practice, since `remove()` alone is dead code.

### Process
- Two rounds of pre-push adversarial review, both NO-MERGE, both fixed before push. **Round 1:** the initial fix only patched the dead-code `remove()` path, leaving the reachable `clear()` leak open; also caught and corrected a false code comment claiming the localStorage-quota emergency prune inside `annotationStore.ts`'s custom `storage.setItem` catch block triggers `remove()` — confirmed false, since that prune path only rewrites the serialized persisted blob directly via `localStorage.setItem` and never touches live Zustand state or calls any store action. **Round 2** (after wiring `clear()`): found a third, distinct, still-unpatched leak — `documentStore.ts`'s `deleteDocument` (wired from `DocumentHubSidebar.tsx`'s delete action, no `<Confirmation>` gate) never touches `annotationStore` or `flowStore` at all, so a deleted document's annotations — not just their held answers — are orphaned forever. Deliberately filed as follow-up **issue #107** rather than folded into this PR, since fixing it properly needs its own design pass: `documentStore.ts` reaching into `useAnnotationStore` (or vice versa) risks a circular import (`annotationStore.ts` already imports `useDocumentStore`). Also fixed a stale test comment still repeating round 1's debunked quota-prune claim.
- `npm run test` — 1072 passing + 10 skipped on the PR branch (1070 before round 2's two added `clear()` tests). New test file `src/stores/__tests__/annotationStore.removeHeldAnswer.test.ts`. `npm run typecheck` / `npm run lint` clean.

**PR #106 (branch `claude/purge-held-answer-on-remove`, https://github.com/Vinylfigure/intent-ide/pull/106) is OPEN, not yet merged to `main` — awaiting operator review.**

Closes #103 (on merge). Files #107.

## [2026-08-20] Stranded branch recovery — answer placement + accessibility (PR #50)

Recovers the salvageable half of `claude/pr-audit-sidebar-options-nvwfu8`, a branch that drifted 32 commits behind `main` and 4 ahead with no PR ever opened.

### Added
- **`layoutStore`:** `answerPlacement: 'sidebar' | 'floating'`, persisted with a stale-value fallback normalizer. `computeFloatingPosition()` — DOM-free, unit-tested clamping math. `FloatingAnswer` — a draggable panel parked beside the passage it answers, dock-to-sidebar and Escape-to-close.

### Fixed
- ~18 icon-only controls gained `aria-label`/`aria-pressed`/`aria-expanded`; literal escaped-glyph characters (`✎`/`✕`/`⎘`) that were rendering as raw text repaired.
- History/Audit moved behind an overflow menu so the sidebar rail's five tabs stop overflowing their container.
- `FloatingAnswer`'s drag pointermove/pointerup listeners are now removed on unmount, not just on the next pointerup.

### Process
- Pre-push adversarial review: one HIGH (an e2e spec's `History` button assertion was orphaned by the overflow-menu move but never updated — fixed by pulling forward the spec fix that already existed for this on the dropped CI commit), one MEDIUM (the held-answer reveal-poll effect wasn't gated like its sibling cascade-reveal effect, so sidebar + floating views of the same answer could double-flash). Both fixed before push.
- Deliberately dropped: the stranded branch's CI/CODEOWNERS commit touched `.github/workflows/**`, which an unattended session cannot write — needs an operator-attended session. Two non-machinery files from that same commit (Playwright sandbox config, a more robust FalkorDB-down probe) were pulled forward since dropping them would have introduced a regression.
- `npm run test` — 924 passing + 10 skipped. `npx playwright test tests/cascade-review.spec.ts` gets past the History-tab click; remaining failure reproduced identically on unmodified `main` (pre-existing, out of scope).

Closes #49

## [2026-08-20] Apply-time drift validation extended to every edit path (PRs #43, #45, #46)

The multi-region cascade-batch apply path already validated proposals against live-document drift before applying. Pure insertions and both single-edit apply call sites (`ResolutionActions.tsx`'s ≤1-edit case, `ConversationThread.tsx`'s per-message apply) did not.

### Added
- **PR #43 — insertion drift validation:** `ProposedEdit.insertionContext` (`{before, after, beforeSpan, afterSpan}`) captured at proposal time, re-derived and verbatim-matched at apply time; a mismatch aborts the whole transaction (no fingerprint recovery exists for an insertion).
- **PR #45 — single-edit drift validation:** `resolveEditRange`/`applySingleEdit`, extracted behavior-preserving from `applyProposedEdits`'s existing loop, now back both single-edit call sites. `refreshAnchorAfterApply()` keeps `annotation.anchor` in sync after a successful apply.
- **PR #46 — multi-region anchor refresh (closes #44):** `findAppliedEditFinalPosition` derives a batch-applied edit's true post-transaction position by summing the length deltas of edits dispatched after it, instead of a fingerprint search.

### Fixed
- Insertion capture/validate uses a fixed position-space radius (`INSERTION_CONTEXT_RADIUS`) shared between capture and validation, not string length (which doesn't survive ProseMirror block-boundary crossings) and not a live re-clamp against current doc size (unstable against unrelated edits elsewhere).
- `#45` round 1 found its own new drift gate regressed repeated "Tweak it" applies (stale `annotation.anchor` after a successful apply); round 2 found round 1's anchor-refresh fix used pre-transaction positions invalid for any non-lowest-`from` edit in a multi-region batch, and **descoped** that gap rather than ship it wrong — filed as #44.
- `#46` round 1's first fix re-derived the true position by fingerprint search; proven unsafe (a short replacement can coincidentally match pre-existing text elsewhere in the block) and replaced with arithmetic, which has no false-positive surface.

### Process
- `#43`: one round of review, two bugs fixed before push. `#45`: two rounds, both real findings fixed (one by a targeted fix, one by honest descoping). `#46`: two rounds, round 1 HIGH (fingerprint-search collision risk) fixed by switching to arithmetic, round 2 verdict MERGE.
- Test counts, checked out and re-run fresh against each actual merge commit (the PR bodies' own self-reported counts undercounted — #31 and #41 also landed in this same merge window): 854 + 10 skipped at #43 (`403355c`); 868 + 10 skipped at #45 (`a2c5347`); 878 + 10 skipped at #46 (`537f385`).

#43 closes #40 and files #42; #45 closes #42 and files #44; #46 closes #44.

## [2026-08-20] DocCommit retention/collapse for 'direct' history versions (PR #41)

`DocCommit` had no retention policy. `'direct'` autosave-flush commits (no AI provenance, no audit linkage) fired on every 5s debounce, doc-switch, and unmount — an actively-edited document accumulated a full-document-snapshot row roughly every 5 seconds, forever, on the shared public demo's Turso free-tier database.

### Added
- **`action: 'amend'` on `POST /api/history`:** a new `'direct'` write replaces the current HEAD in place if and only if that head is *also* a `'direct'` commit with no child yet — one continuous editing session collapses to one row, refreshed on every autosave. `import`/`apply`/`restore` are hard-rejected (400) as amend targets or sources; this is a narrowly-scoped, structurally-enforced exception to the append-only rule, not a general relaxation of it.

### Fixed
- **TOCTOU race (pre-push adversarial review, HIGH, reproduced):** the amend target was read once outside the `$transaction`, and the in-transaction re-check only detected a newly-appended child, not the target having been fully deleted-and-replaced by a second concurrent amend — turning a normally-recoverable stale-head race into an unhandled 500 instead of the documented 409. Fixed by moving the entire read-validate-delete-create sequence inside the transaction. Verified concretely: the regression test fails against the reverted pre-fix code (`[200, 500]`) and passes against the fix (`[200, 409]`).

### Disclosed
- Two genuinely concurrent `'direct'` writers (e.g. two browser tabs) can amend over each other with no merge — judged acceptable since `'direct'` carries no compliance weight, stated plainly in `docs/compliance.md`.
- `npm run test` — 850 passing + 10 skipped at merge (`3984757`, checked out and re-run fresh).

Closes #39

## [2026-08-19 → 2026-08-20] Legacy project-UI cleanup + migration hardening (PRs #36, #38)

### Removed
- **PR #36:** `src/components/Layout/ProjectSidebar.tsx` and `src/stores/projectStore.ts` — the pre-Phase-8 project UI, superseded by `DocumentHubSidebar.tsx`/`documentStore.ts` since 2026-03-16. Verified zero live references repo-wide; `documentStore.ts`'s legacy migration reads its localStorage key directly and never imported the deleted store.

### Fixed
- **PR #38 (closes #37):** `runLegacyProjectMigration()` could throw on malformed `intent-ide-projects` data; because `hasMigratedLegacyProjects` was only set on the non-throwing path, an affected user's migration would silently fail and silently retry (and fail again) forever. Fixed with per-project and per-document failure isolation, an outer catch-all so migration never retries forever against unrecoverable data, and a `safeSet()` wrapper (verified against zustand's actual persist internals) that swallows a `QuotaExceededError` without losing the state change.

### Process
- The real production symptom was traced against zustand's actual `onRehydrateStorage` wiring rather than assumed: the app's hydrate path already swallows a callback throw, so pre-fix this was a silent permanent migration failure, not a visible boot-loop crash — `runLegacyProjectMigration` is also a public store action reachable by direct calls, where a throw does propagate, so the fix still mattered.
- Two rounds of adversarial review, each catching a coarser isolation boundary than the data required (project-level, then document-level).
- `npm run test` — 749 passing + 10 skipped after #36; 860 passing + 10 skipped at #38's merge (`00e88c8`, checked out and re-run fresh — #31 and #41 also landed in this window).

Closes #33, #37

## [2026-08-18 → 2026-08-20] Fleet Autonomy Machinery — work-loop skill, dispatch channel, CI fix (PRs #28, #30, #47)

Extends the fleet-autonomy machinery instantiated 2026-08-16 (below).

### Added
- **PR #28:** `.claude/skills/work-loop/SKILL.md` committed — the armed work-loop Routine's spec had existed only as a scheduler payload. Adapted from janus to this repo's own toolkit (`test`/`add-feature`/`build-component`/`add-api-route` skills, a spawned subagent for adversarial review); makes the headless permission boundary explicit (no writes to `.claude/hooks/**`, `.github/workflows/**`, `.claude/settings.json` from an unattended firing) with a preflight-before-starting step.
- **PR #30:** `claude.yml` dispatch workflow — the portfolio registry claimed this stream accepted dispatched work orders with no workflow actually present. Permission grant derived from this repo's own `ci.yml`; deliberately withholds `npx:*`/`npm:*`/`node:*` and `prisma migrate deploy`. Dispatch secret still needs setting on the repo (operator action) before an order can run.

### Fixed
- **PR #47:** `ci.yml`'s `pull_request` trigger filtered on `branches: [main]` — matching the PR's *base*, not head — so a PR stacked on another PR's branch got zero CI runs, and a base-branch retarget after the base merges fires no workflow run either. Invisible until `verify` became a required status check, at which point a stacked PR (#46) sat permanently blocked until an empty commit forced a run. Fixed by dropping the base-branch filter from `pull_request` (kept on `push`).

## [2026-08-18 → 2026-08-20] Ablation harness scaffolding for arms B/D/E (PR #31)

Scaffolds the graph-scoped-vs-whole-doc cascade ablation (#19) with arms B (whole-doc plan-then-patch + self-verify), D (whole-doc free edits + deterministic verify/repair), and E (cheap-model variants) — all runnable today with no live provider key. Arm C (shipped `proposeCascadeEdits`) is unchanged and used as-is; arm A is intentionally out of scope.

### Added
- `src/lib/graphrag/ablationArms.ts` implementing the three arms, sharing `resolveProposedEdits`/`applyRelevanceJudge` (extracted, behavior-preserving, from `orchestrator.ts`) as common substrate so arms differ only in candidate generation, not anchoring/evidence/severity logic.
- 67 new tests exercising all 3 arms × cheap-model on/off × every existing EditPropBench fixture with scripted calls — proves the harness runs cleanly and produces the right metrics shape; not a quality gate on B/D's actual numbers, which the still-blocked live run exists to measure.

### Fixed
- Adversarial review found the first version of arm B collapsed plan-then-patch into a single call (architecturally arm A + verify, not arm B) — fixed into a genuine two-stage PLAN-then-scoped-PATCH pipeline before push.

### Process
- `npm run test` — 816 passing + 10 skipped (+67 new).
- Live run against a real provider stays blocked on #19 (operator-supplied key). No provider is faked anywhere in this change.

Closes #27

## [2026-08-20] Document Invariant Ledger — doc-CI complete (PRs #29, #34, #48, #52)

Closes the "tests for prose" spike (#20) in four phases: a user-declared fact captured at semantic-commit time becomes a runnable assertion that every later apply regression-tests, with a failing fact surfacing as a cascade flag naming the invariant it broke.

### Added
- **Phase 1 (#26, PR #29):** `DocInvariant` Prisma model, `POST/GET /api/invariants`, `captureInvariant.ts`. Append-only — no PATCH/DELETE route exists.
- **Phase 2 (#32, PR #34):** `invariantCheckRunner.ts` deterministic check lane, reusing the cascade's own `extractChangedTokens` + `containsTerm` rather than new extraction logic. Numeric comparison is value-equality, not string-equality (`$30` / `30` / `30.00` are one figure). Surfaced through the existing `CascadeList` via `invariantCascade.ts`.
- **Phase 3 (#35, PR #48):** `POST /api/invariants/resolve` — a status transition appends a new row with `supersedesId` pointing at its target instead of mutating it, mirroring the `DocCommit.parentHash` chain. `supersedesId` is a DB-enforced unique column; the route reports a clean 409 on the race.
- **Phase 4 (#51, PR #52):** the LLM entailment lane — `entailmentCheck.ts`, `classifyCheckKind`, and the `invariantEntailmentEnabled` setting.

### Fixed
- **`checkKind: 'entailment'` was dead weight from Phase 1 until Phase 4.** No code path had ever created *or* checked an entailment-kind invariant, so any declared fact the figure-matching lane structurally cannot check — word-form numbers, calendar-date fragments, plural variants, claims with no exact-match anchor — was captured as `'deterministic'` and then silently skipped forever.

### Security / Privacy
- The entailment lane is gated on `invariantEntailmentEnabled`, **default OFF** and rehydrate-backfilled to OFF (anything other than an explicit stored `true` resolves to off — same rule as `telemetryEnabled`). It is the only doc-CI path that spends money and sends document text; the deterministic lane stays local and always-on regardless. Runs on a user-initiated apply only, never on typing. Its graph build passes `skipLlm`/`skipEmbeddings`/`skipGraphiti`, so it is a cache hit and never itself a network call.

### Process
- Pre-push adversarial review returned **NO-MERGE with 2 HIGH findings**, both reproducible, both fixed with regression tests before the PR was opened — see `audit.md` for the full record. Headline: a classifier mirroring only the receiving lane's *first* skip gate left plural-variant and calendar-date statements in **neither** lane, while the pre-existing hardcoded `'deterministic'` default would have made the new lane a permanent no-op on every existing ledger. One fix (runtime fallthrough in `runAndSurfaceInvariantChecks`) closed both, and closed the second without a backfill migration.
- Not exercised: the entailment lane has never run against a live provider — every test injects a scripted judge. Needs an operator-supplied key, same constraint as #19.

## [2026-08-16] Fleet-Autonomy Machinery (branch `claude/fleet-status-machinery`)

Instantiated the Janus-style fleet-autonomy machinery — repo-level automation plumbing only, zero `src/` changes, 731-test suite untouched.

### Added
- **`.github/loops.yaml`:** git source of truth for expected automations (detect-only; `enabled: false` = declarative kill switch). Declares `work-loop` (routine, not armed — issue #23) and `fleet-status` (github-action, enabled).
- **`.github/workflows/fleet-status.yml` + `scripts/fleet-status.sh`:** cron `17 */4 * * *` sweep — idempotent label vocabulary, aging/overdue ladder on `question:` issues and `claude/*` PRs (never closes; owner comment clears), L-047 stale-branch detector, and a single "Status dashboard" issue rewritten in place. Exits non-zero iff red findings; `--dry-run` supported for stubbed-`gh` testing.
- **`.github/workflows/gate-integrity.yml`:** fails PRs that touch `.github/workflows/**`, delete test files, or add `.skip(`/`xit(`/`xdescribe(` — unless labeled `machinery-change`.
- **`.github/ISSUE_TEMPLATE/`:** `task.yml` (required "Done means"), `question.yml`, `config.yml` (blank issues allowed).
- **`.github/CODEOWNERS`:** `/.github/` owned by @Vinylfigure.

## [2026-07-09] Cascade v2 Complete (Waves B, C, D — PRs #9-#12)

The Cascade v2 roadmap is CLOSED. After Waves A + E (PRs #5/#6), the final three waves landed as **PR #9** (Wave D3+D4: e2e + README), **PR #10** (Wave B: scale/recall), **PR #11** (Wave C: trust/flow-state UX), and **PR #12** (Wave D1+D2 finale: Graphiti bridge, consolidation, telemetry). Process record: **five waves, five pre-PR adversarial Troublemaker reviews, five NO-MERGE verdicts — every HIGH finding fixed with regression tests before anything was pushed.** Worktrees ran A∥E then B∥D3+D4 in parallel; B∥C was deliberately serialized (`docGraph.ts` overlap).

### Added
- **[PR #9 / Wave D3] Playwright e2e `cascade-review.spec.ts`:** full annotate → cascade → review → apply → history flow through the real UI; LLM endpoints intercepted (deterministic), audit/history routes real.
- **[PR #9 / Wave D4] README** architecture / compliance / evaluation sections.
- **[PR #10 / Wave B] Per-block incremental docGraph:** changed-block re-extraction seeded from the PRIOR graph's adjacency (review caught monotonic LLM-edge decay in unseeded rebuilds); chunked LLM extraction only above a 150-block single-call threshold (review caught unconditional chunking silently regressing 41-200-block recall).
- **[PR #10 / Wave B] Embeddings edge source:** `/api/embed` + `embedEdges.ts` with a transient-throw / permanent-null contract (transient failures are never cached); provider-keyed vector cache; 300-block cap; `headingPath` in payloads.
- **[PR #11 / Wave C] "Why this proposal?" UI:** `docGraphStore` + `findEdgePath` edge-path explanation per proposal; StatusBar graph chip.
- **[PR #11 / Wave C] "AI data & spend" settings panel:** `judgeEnabled` / `embeddingsEnabled` / `embedModel` + session spend estimate (known debt: excludes transcription).
- **[PR #12 / Wave D1] `augmentWithGraphitiEdges`:** entities as the third docGraph edge source; ≤12 entities / ≤120 edges per build; abortable 1500ms MCP deadline (review found entity COUNT was the unbounded flooding axis).
- **[PR #12 / Wave D2] `cascadeCalibration` telemetry:** closed-enum, metadata-only events; local aggregate always; PostHog capture opt-in **default FALSE**; modal decisions buffered and flushed on confirm; `applied` recorded only after a successful apply; miscalibration hint at n≥5.

### Changed
- **[PR #11 / Wave C] Flow-state buffering REDESIGNED:** reveal flags live INSIDE `proposedChangePlugin` — held cascades keep their anchors mapped; only decorations are suppressed until the reading breakpoint. (The first design withheld held edits from the plugin and hard-broke apply.)
- **[PR #11 / Wave C] Re-anchoring is validate-stored-first:** stored range validated before any fingerprint search (fingerprint-first silently relocated valid blockId-less anchors). Modal cancel now snapshot/restores plugin status.
- **[PR #12 / Wave D1] `getNeighborhood` is SOURCE_PRIORITY-aware:** returns `{hop, sourceRank}`; candidate ordering under the 24-block budget is source-quality-aware so graphiti co-mentions cannot evict LLM-attested dependents.
- **[PR #12 / Wave D2] One cascade surface:** show-affected scroll/pulses to `CascadeList`, status-gated via `showAffectedMode`; no parallel cascade UI remains.

### Fixed
- **[PR #9, CRITICAL — found by writing the e2e] Streaming-path cascades never fired in production:** `streamResolveAnnotation`'s MADS branch never called `attachCascadeEdits`; the live app streams, so cascades were feature-dead while 500+ unit tests stayed green on the non-streaming path. Fixed with streaming/non-streaming parity + regression tests.

### Verification
- **579 unit tests passing + 10 skipped** on the finale branch (`main` matches post-merge); cascade e2e green; ingestion e2e requires local FalkorDB (pre-existing). Typecheck/lint/build clean.

### Carry-forward debts
- Insertions bypass fingerprint validation (documented in-code); spend estimate excludes transcription; graphiti augmentation is one-shot per content hash; inflight-dedupe can hand a deterministic-only graph to a concurrent cascade (pre-existing); ingestion e2e needs FalkorDB; the user's uncommitted Turso deployment changes sit in the main working tree (theirs).

## [2026-07-09] Deployment LIVE — https://intent-ide.vercel.app (PR #8 MERGED)

The public portfolio demo is deployed and live. **PR #8 MERGED to `main`; production deploy READY and aliased at https://intent-ide.vercel.app** (same day as the prep work below).

### Deployed
- **Turso DB `intent-ide-audit`** (`libsql://intent-ide-audit-vinylfigure.aws-us-west-2.turso.io`): all 3 migrations applied; schema verified **byte-identical** against a fresh local sqlite3 build of the migrations. (A partial apply mid-process left a stray `DocumentSource` table — `turso db shell` is non-transactional and stops at the first error; recovered by dropping the stray table + schema diff. New rule: always diff schemas after manual Turso migrations.)
- **Vercel project `intent-ide`** (team `vinylfigures-projects`) linked; production env vars set: `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `AUDIT_ADMIN_TOKEN` (admin token in local gitignored `.env`); production redeployed.
- **End-to-end production smoke test PASSED:** audit POST → row confirmed in Turso; visitor-scoped GET returns own record; other `userId` sees 0; unscoped GET without token 401 / with admin bearer 200; `/api/history` 403 (gate working); SSRF probes (`http://169.254.169.254`, `https://[::ffff:169.254.169.254]`) 400.

### Known Issues
- **PR #9 (`claude/cascade-v2-d`) preview deploys fail** with `Can't resolve '@/generated/prisma/client'` until the branch is rebased onto `main` to pick up PR #8's `prisma generate && next build` script.

## [2026-07-09] Vercel + Turso Deployment Prep — Public-Exposure Hardening (PR #8)

Deployment prep for the public portfolio demo: Vercel hosting with the audit DB on Turso (hosted libSQL), plus hardening of every publicly reachable API surface. Shipped as PR #8 (branch `claude/vercel-deploy`, https://github.com/Vinylfigure/intent-ide/pull/8) — **MERGED to `main` 2026-07-09; see the Deployment LIVE entry above.**

**Decision:** Turso over Supabase — the existing `@prisma/adapter-libsql` + SQLite migrations work unchanged, and Turso's free tier doesn't auto-pause (Supabase free pauses after ~1 week idle, bad for an always-on demo). Supabase (Auth + Postgres) is deferred to a future commercialization phase (accounts + doc sync), not rejected.

### Added
- **`src/lib/server/validateBaseUrl.ts`:** Production-only SSRF blocklist on the client-supplied `x-base-url` header, wired into `/api/resolve`, `/api/classify`, `/api/generate`, `/api/structured` (400 on violation). Fails closed on WHATWG hex-group v4-mapped IPv6 (e.g. `[::ffff:a9fe:a9fe]`); handles FQDN trailing dots; blocks private IPv4/IPv6 ranges; https-only.
- **`getVisitorId()` in `auditLogger.ts`:** Anonymous per-browser UUID used to scope `/api/audit` GETs via `?userId=`.
- **README Deployment section:** Live-demo link (PLACEHOLDER `https://intent-ide.vercel.app` until the Vercel project exists), BYOK note, known limits, Turso migration procedure.
- **92 new tests:** SSRF matrix, auditLogger, audit route, history gate.

### Changed
- **`src/lib/db.ts`:** `PrismaLibSql` now passes `DATABASE_AUTH_TOKEN`; local `file:dev.db` unchanged.
- **`package.json`:** `build` = `prisma generate && next build`; `postinstall` runs `prisma generate`; `engines` >= 20.
- **Guarded proxy fetches:** Now use `redirect:'manual'` — a validated public https URL could otherwise 3xx to a private address (redirect-to-private-IP SSRF vector).
- **`/api/audit` hardened:** Real-body 16KB cap (not just content-length); oversize fields reject 400 — never truncate (truncation would corrupt JSON provenance fields); per-IP soft rate limit keyed on `x-real-ip`; GET scoped by `?userId=`; unscoped GET requires Bearer `AUDIT_ADMIN_TOKEN` and fails closed in production. Disclosed limitation: `userId` is client-supplied — a courtesy partition, not a security boundary.
- **`/api/history` (from PR #6):** Gated OFF in production (403) unless `HISTORY_ENABLED=1` — it stores full unauthenticated document snapshots, which the shared public demo must not do.
- **`maxDuration = 60`** on the 5 LLM/transcription routes.
- **Turso schema procedure:** Prisma 7.5's config has NO driver-adapter hook for migrate, so the Turso schema is applied by piping `prisma/migrations/*/migration.sql` through `turso db shell` (documented in a `prisma.config.ts` comment + README).

### Verification
- 462 tests passing + 10 skipped (post PR #5/#6-merge baseline was 370 + 10; +92). `npm run typecheck` / `lint` / `build` clean.
- Graphiti/FalkorDB confirmed local-dev-only (all call sites client-side with fallbacks) — the deployed demo has no graph-server dependency.

### Operator steps
- ALL COMPLETED same day — Turso DB + migrations, Vercel project + env vars, smoke test, merge. See the Deployment LIVE entry above. The README demo URL needed no fix (the Vercel project name matched the placeholder).

## [2026-07-09] Cascade v2 Waves A + E — Precision Judge + Git-Model Document History

Two Cascade v2 waves, built in parallel git worktrees (`../IDE-wave-a`, `../IDE-wave-e`) off merged PR #4, each through a full implement → adversarial-review → fix cycle (both Troublemaker reviews returned NO-MERGE with HIGH findings; all fixed pre-PR). **PR #5 (`claude/cascade-v2-a`, 7 commits) and PR #6 (`claude/cascade-v2-e`, 7 commits) — both MERGED to `main` (post-merge baseline 370 tests + 10 skipped).** Waves B/C/D remain on the roadmap.

### Added
- **[Wave A] `src/lib/ai/relevanceJudge.ts`:** Batched LLM judge verifying that `must`-candidates' citations GENUINELY conflict (closes the `hasVerbatimConflict` existence-vs-relevance gap). Target block context included in judge input; the judge can only LOWER severity; the judge prompt contains no severity vocabulary. Robustness semantics: judge malfunction (thrown call OR zero valid verdicts) preserves derived severities — only real per-candidate verdicts demote; `maxTokens` scales with candidate count; deny-wins on duplicate verdict indexes.
- **[Wave A] `pickUtilityModel` in `src/lib/ai/modelCapabilities.ts`:** Pins the relevance judge + context compaction to `claude-haiku-4-5` (claude provider only). Graph extraction deliberately stays on the user's selected model (recall mechanism, not housekeeping).
- **[Wave A] `fetchWithRetry` in `src/lib/ai/structuredClient.ts`:** Retries 429/5xx, 2 retries, jittered backoff.
- **[Wave A] Opt-in live bench:** `editPropBench.live.test.ts` + `npm run bench:live` (`BENCH_LIVE=1`, needs the dev server, preflight fail-fast, asserts non-empty measurement, dumps to gitignored `bench-results/`).
- **[Wave E] `DocCommit` Prisma model:** Migration `20260709205301_add_doc_commit_history`. Two-level content addressing like git's tree+commit: `contentHash` = sha256(canonical docJson); commit `hash` covers documentId + parentHash + contentHash + kind + message + actor + annotationId + auditIds + modelVersion — attribution is INSIDE the address.
- **[Wave E] Append-only `/api/history`:** POST create-only; server recomputes both hashes (400 on mismatch); 409 stale-head enforcing linearity with client rebase-retry-once; idempotent duplicates; no update/delete.
- **[Wave E] `src/lib/history/`:** `canonical.ts`; `commits.ts` — `createCommit` (contentHash-dedupe, kind-aware), `blameBlock`, `restoreCommit` TRANSACTIONAL (flush pending edits → HUMAN_RESTORE audit event with id embedded in the restore commit's `auditIds` → commit → only then dispatch `replaceWith` with `addToHistory: false`).
- **[Wave E] Capture points:** 'import' root commit; 'apply' commits with `blockIdsTouched` + `auditIds` + actor `ai+human` + `modelVersion` and `ChangeSet.commitHash` linkage; 'direct' commits on autosave/doc-switch/unmount flushes.
- **[Wave E] `HistoryPanel.tsx` + AppShell History tab:** Accessible language (Version / Compare / Restore / "Last changed by"); pagination past 200; Confirmation-gated restore (HITL).
- **[Wave E] `docs/compliance.md`:** HONEST framing — application-enforced append-only, tamper-EVIDENT not immutable, client-supplied attribution, `auditFailed` → zero-audit-links disclosed.

### Changed
- **[Wave E] CI:** Now runs `prisma migrate deploy` (PR #6's CI run exercises it for the first time).
- **[Wave E] `changeTrackingPlugin`:** Skips `addToHistory: false` transactions.

### Fixed
- **[Wave A, Troublemaker] Judge malfunction misread as denial:** Zero-valid-verdict responses are protocol malfunctions and no longer demote candidates.
- **[Wave E, Troublemaker] Provenance absorption:** Content-only hashing let a racing 'direct' autosave silently absorb an 'apply' commit's AI provenance; fixed by putting attribution inside the commit hash.
- **[Wave E] Phantom full-doc "Direct edit" entries on restore/doc-switch:** Eliminated via the `changeTrackingPlugin` `addToHistory: false` skip.

### Removed
- **[Wave E] Unused `DocumentSource` Prisma model:** Dropped in the same migration; migration verified against a populated pre-existing DB.

### Reverted
- **[Wave A] Prompt-caching commit:** Added then REVERTED in-branch after review proved it a cost regression — zero shared prefix cascade→judge, in-process cache absorbs identical rebuilds, and the 2000-char trigger is below Anthropic's 1024/2048-token cacheable minimum (1.25x write surcharge, zero possible hits).

### Verification
- `main` (post-PR #4 merge) — 287 tests passing.
- PR #5 branch — 322 tests passing + 10 skipped (opt-in live bench).
- PR #6 branch — 335 tests passing.

## [2026-07-09] v8.4 — Precision-First Cascade Graph

Rebuild of the cascade around a block-keyed document dependency graph. Built from `docs/fable5-cascade-brief.md` (local, untracked). Shipped as 8 commits (`d7e1a23..bafccea`) on branch `claude/cascade-graph` via **PR #4 — MERGED to `main` 2026-07-09** (`main` is branch-protected).

### Added
- **Stable block IDs:** `schema.ts` `withBlockId` — persistent `blockId` attr on paragraph/heading/blockquote/code_block/list_item. `parseDOM` deliberately does NOT read `data-block-id`, so pasted content mints fresh ids. New `src/lib/prosemirror/blockIds.ts` (`collectBlocks`, `collectTextblocks`, `findBlockById`, `blockIdAtPos`, `computeBlockIdFixes`, `blockTextRange`) and `src/lib/prosemirror/plugins/blockIdPlugin.ts` (`appendTransaction` stamping; duplicate keeper = first NON-EMPTY occurrence; stamps ride the triggering history event; initial-load stamping deferred via `queueMicrotask` with `addToHistory: false`).
- **`src/lib/graphrag/docGraph.ts`:** Block-keyed dependency graph. Deterministic extractors (cross-refs→headings, defined terms, duplicated sentences) + ONE validated `link_blocks` LLM pass (capped at 200 textblocks). FNV-1a `contentHash` LRU-8 cache with inflight dedupe. `getNeighborhood` BFS. `scheduleDocGraphRebuild` / `cancelScheduledDocGraphRebuild` (wired in `EditorShell`) run deterministic-only in the background — the LLM pass runs lazily inside the user-initiated cascade only.
- **`src/lib/ai/structuredClient.ts`:** Injectable `CallStructuredFn` seam for testability; `fetchStructured` THROWS on `!res.ok` so empty-`toolCalls` ("no dependencies") is never conflated with provider-down (cache-poisoning guard).
- **Severity/evidence types in `types.ts`:** `CascadeSeverity` (`'must' | 'probably' | 'optional'`), `CascadeEdgeType`, `CascadeEvidence` (`{sourceBlockId, quotedText, edgeType} | null`), `ProposedEdit.blockId?`, `SEVERITY_ORDER`/`SEVERITY_LABELS`, `normalizeProposedEdit()` (applied in `annotationStore` rehydration; legacy primaries → `must`, legacy cascades → `probably`).
- **EditPropBench-grounded eval harness:** `src/lib/graphrag/__tests__/editPropBench.{fixtures,test}.ts` — 10 fixtures with direct-target / required-downstream / protected-unchanged labels (arXiv:2605.02083 — real, verified; the circulating "LEDGER agentic editing" citation is FABRICATED — do not cite). Gates recall ≥ 0.9 / 0 false-positive violations / 100% citation validity. Pipeline regression gate (scripted model), not a model benchmark.
- **Editor mount smoke suite:** `src/lib/prosemirror/__tests__/editorMount.smoke.test.ts` (jsdom devDependency added) — permanent gate against constructor-time plugin crashes that headless tests cannot see.
- **Severity UI:** severity badge + evidence line in `ProposedEditControl`; sorted severity pills in `CascadeList`; severity/relation on `SemanticChange` with badges in `SemanticCommitModal`; `globals.css` `proposed-severity-*` variants.

### Changed
- **`src/lib/ai/orchestrator.ts` `proposeCascadeEdits` rewritten graph-scoped:** 2-hop neighborhood, `maxBlocks` 24 (block COUNT capped — block text never truncated), blockId-first anchoring via `blockTextRange` with neighborhood-gated `findTextInDoc` fallback, first-proposal-wins overlap gate, evidence verified verbatim against the live doc, severity DERIVED (`deriveSeverity` / `hasVerbatimConflict` / `extractChangedTokens` with stopword filter + 2-char number floor) — never trusted from the model.
- **`src/lib/ai/resolver.ts` `attachCascadeEdits`:** the `.slice(0, 6000)` whole-doc truncation is DELETED — the graph now bounds context; long documents cascade past page 4.
- **`src/components/Annotations/ResolutionActions.tsx`:** rows sorted primary-first then severity; accept-all defaults to `must`+`probably` — `optional` edits are pre-toggled off unless accepted inline.
- **`changeTrackingPlugin`:** skips transactions carrying `blockIdPluginKey` meta (id stamping is not a user change).

### Fixed
- **CRITICAL editor mount crash (swarm review):** the blockId plugin's `view()` dispatched during `EditorView` construction → TDZ ReferenceError on `const view` in `EditorShell` `dispatchTransaction`. Fixed by deferring the initial dispatch via `queueMicrotask`. Note: typecheck/build/vitest were all green while the app could not mount — hence the new jsdom mount smoke suite.
- **Undo resurrecting a previous document:** doc-switch `replaceWith` is now `addToHistory: false` — Cmd-Z could previously restore the prior doc's content and autosave it under the NEW doc's id.
- **Drift recovery:** `applyProposedEdits` re-resolution is blockId-scoped first before any text search.
- **Invisible control bytes:** `contentHash` separator sentinels (u0001/u0002) were raw control characters embedded in the source literal; rewritten as visible backslash escapes.

### Verification
- `npm run typecheck` — 0 errors. `npm run lint` — clean. `npm run build` — clean.
- `npm run test` — 287 passing (was 194; +93).
- Landed as PR #4 (https://github.com/Vinylfigure/intent-ide/pull/4) — MERGED to `main` 2026-07-09.

## [2026-07-08] Public Release Packaging

### Added
- `README.md` — project overview, architecture map, engineering highlights, setup and testing instructions.
- `LICENSE` — MIT.
- `.github/workflows/ci.yml` — CI pipeline (Prisma generate → typecheck → lint → unit tests → production build) on Node 20.
- `.eslintrc.json` — explicit ESLint config (`next/core-web-vitals`).
- `package.json` metadata: description, author, repository, license, keywords.

### Changed
- `docs/specs/*.md` — added provenance notes explaining the bracketed PRD citation markers.
- `test-api.sh` moved to `scripts/test-api.sh`.
- Session-scratch memory-bank files (`raw_reflection_log.md`, `activeContext.md`, `consolidated_learnings.md`) are now local-only (gitignored); the curated memory-bank documents remain published.

### Removed
- Stale `Old.md`, committed `__pycache__` bytecode, Playwright `test-results` artifact, and the internal PRD PDF from version control.

## [Unreleased]
### Added
- Initialized the AI Agent Memory Bank architecture (`projectBrief.md`, `productContext.md`, `systemPatterns.md`, `techContext.md`, `activeContext.md`, `progress.md`).
- Defined the core EU AI Act compliance database schemas (Article 12 and 14).
- Established the Multi-Agent Debating System (MADS) orchestration rules.
- **[2026-03-13]** Installed shadcn/ui: `components.json`, `cn()` utility at `src/lib/utils.ts`, CSS variable theming in `globals.css`, `tailwindcss-animate` plugin. Verified with Button component.
- **[2026-03-13]** Installed assistant-ui (`@assistant-ui/react`, `@assistant-ui/react-streamdown`, `@streamdown/code`) and Vercel AI SDK (`ai@^3.1.0`).
- **[2026-03-13]** Set up Prisma v7 with SQLite: 4 compliance models (`DocumentSource`, `Annotation`, `Resolution`, `AuditLog`), initial migration applied, client singleton at `src/lib/db.ts` using `@prisma/adapter-libsql`.
- **[2026-03-13]** Created Graphiti MCP HTTP client stub at `src/lib/mcp/graphitiClient.ts` with `addEpisode`, `searchNodes`, `getSubgraph` exports.
- **[2026-03-13]** Built `AgentMarkdown` component (`src/components/ui/AgentMarkdown.tsx`) using `Streamdown` from `streamdown` with `remend` config. Extracts `<thinking>` / `REASONING:` blocks into collapsible `<details>` section.
- **[2026-03-13]** Built conflict severity highlighting: `conflictPlugin.ts` (ProseMirror plugin), `conflictStore.ts` (Zustand), `ConflictTooltip.tsx` (portal tooltip). Red for direct conflicts (#dc2626), orange for ambiguous (#f59e0b).
- **[2026-03-13]** Built token-level uncertainty visualization: `uncertaintyPlugin.ts` (ProseMirror plugin with HSL background gradients from edit-model probability), `uncertaintyStore.ts` (Zustand store). No raw numerical scores shown per spec.
- **[2026-03-13]** Built local resolution controls: interactive `ConflictTooltip` with Revise/Delete/Accept/Dismiss buttons. Click-to-pin conflict highlights. Per-conflict accept/reject without global undo.
- **[2026-03-13]** Built Impact Analysis Command: `impactAnalysis.ts` (LLM-powered conflict detection), `IMPACT_ANALYSIS_PROMPT` and `IMPACT_ANALYSIS_WITH_REWRITES_PROMPT` in `prompts.ts`. Finds text positions via `findTextInDoc()`, creates conflict decorations.
- **[2026-03-13]** Built Plan/Act Diff Viewer: `DiffViewer.tsx` (word-level LCS diff), `Confirmation.tsx` (HITL gate), `SemanticCommitModal.tsx` (modal combining diff + confirmation). Full CSS in `globals.css`.
- **[2026-03-13]** Set up FalkorDB via Docker Compose (`docker-compose.yml`) with health check and persistent volume.
- **[2026-03-13]** Built Graphiti MCP server (`mcp_server/graphiti_mcp_server.py`) with 5 tools: `add_episode`, `search_nodes`, `search_facts`, `get_entity_subgraph`, `invalidate_edge`. Uses correct Graphiti v0.28.2 API: `FalkorDriver`, `LLMConfig`, `_search` with `SearchConfig`, direct Cypher for edge invalidation.
- **[2026-03-13]** Built MCP server config (`mcp_server/config.py`) with FalkorDB, LLM, and server settings. Python-dotenv for env loading.
- **[2026-03-13]** Upgraded TypeScript MCP client (`src/lib/mcp/graphitiClient.ts`): added `searchFacts()`, `invalidateEdge()`, `GraphEdge` interface. Extended `SubgraphResult` with temporal fields (`validAt`, `invalidAt`).
- **[2026-03-13]** Built Episode Ingestion service (`src/lib/graphrag/episodeIngestion.ts`): `ingestAnnotationEpisode()` feeds resolved annotations into GraphRAG, `ingestEditEpisode()` captures before/after text of edits. Both non-blocking with silent failure.
- **[2026-03-13]** Built GraphRAG-powered Cascade Check (`src/lib/graphrag/cascadeCheck.ts`): `runCascadeCheck()` queries knowledge graph via `searchNodes` → `getSubgraph` for multi-hop blast radius. Maps entity names to ProseMirror positions. Falls back to keyword-based `checkCascade()` if MCP unavailable.
- **[2026-03-13]** Added MADS prompts to `prompts.ts`: `TROUBLEMAKER_PROMPT` (Level 1 Sycophancy), `PEACEMAKER_PROMPT` (Level 5), `JUDGE_PROMPT` (factual verifier), `INTENT_COMPLEXITY_PROMPT` (routing classifier).
- **[2026-03-13]** Built MADS orchestrator (`src/lib/ai/mads.ts`): LangGraph-style TypeScript state machine with `MADSState`, `classifyComplexity()` routing, `fetchGraphContext()`, three-agent debate chain, verdict parsing, `<chain-of-thought>` debate log output.
- **[2026-03-13]** Built token-level uncertainty extraction (`src/lib/ai/uncertainty.ts`): `computeTokenEntropy()` with exact `H = -Σ (p * log(p))` formula, `buildUncertaintyMap()`, `applyUncertaintyFromLogprobs()`, `applyUncertaintyFromFlags()` fallback for Claude.
- **[2026-03-13]** Added `callLLMWithLogprobs()` to `client.ts` returning `LLMResponse` with `content` + `logprobs`.
- **[2026-03-13]** Built context compaction node in `resolver.ts`: `maybeCompactContext()` triggers `CONTEXT_COMPRESSION_PROMPT` when session exceeds 50% of 128k context window.
- **[2026-03-13]** Upgraded Prisma `AuditLog` model from 8 fields to full 14-field Minimum Viable Audit Schema: added `modelName`, `promptVersion`, `queryClassification`, `sourceDocuments`, `confidenceScore`, `responseId`, `outputType`, `regulatoryContext`, `approvalStatus` (default `PENDING_REVIEW`), `dataRetentionDays` (default 2555), `overrideOf`, `overrideReason`. Made `resolutionId` optional. Migration `add-compliance-audit-fields` applied.
- **[2026-03-13]** Built append-only audit logging service (`src/lib/audit/auditLogger.ts`): `logAuditEvent()` writes via `/api/audit` route (client-safe), `logResolutionAudit()` for resolution events, `logOverrideAudit()` for human overrides. No update/delete by design.
- **[2026-03-13]** Built human oversight controls (`src/lib/audit/approvalGate.ts`): `recordHumanDecision()` creates new audit records for approve/reject/modify, `handlerToApprovalAction()` maps UI handlers to approval statuses.
- **[2026-03-13]** Created `/api/audit` server-side route (`src/app/api/audit/route.ts`) for append-only Prisma audit writes. Keeps Node.js dependencies out of client webpack bundle.

### Changed
- Transitioned product requirements from PRD v6.0 to v7.0, formally adopting the "Semantic Commit" framework.
- Upgraded the RAG architecture to GraphRAG utilizing FalkorDB and Graphiti via MCP for multi-hop "blast radius" reasoning.
- **[2026-03-13]** Updated `tailwind.config.ts`: added shadcn CSS variable colors alongside existing palette, `darkMode: ["class"]`, `borderRadius` vars, `tailwindcss-animate` plugin. Existing `muted` and `border` keys now use CSS variables.
- **[2026-03-13]** Wired `AgentMarkdown` into `ConversationThread.tsx` (agent messages) and `AnnotationCard.tsx` (resolution content) — replacing plain text rendering with markdown.
- **[2026-03-13]** Added `conflictPlugin` to ProseMirror plugin bundle in `plugins/index.ts`. Mounted `ConflictTooltip` in `EditorShell.tsx`.
- **[2026-03-13]** Added `uncertaintyPlugin` to ProseMirror plugin bundle in `plugins/index.ts`.
- **[2026-03-13]** Upgraded `ConflictTooltip` from read-only to interactive: added resolution buttons, click-to-pin, outside-click dismiss. Extended `conflictStore` with `resolution`, `proposedText`, `activeConflictId`. Added click handler to `conflictPlugin`.
- **[2026-03-13]** Updated `globals.css`: replaced `.conflict-tooltip` (pointer-events:none) with `.conflict-tooltip-interactive` (interactive), added `.conflict-action-btn` styles, added `.uncertainty-highlight` styles.
- **[2026-03-13]** Extended `CommandPalette.tsx` with three semantic commit commands: "Check for Conflicts", "Make Change (with rewrites)", "Clear All Conflicts". Added two-phase UX (command select → intent input → Enter to analyze).
- **[2026-03-13]** Added `globals.css` styles: `.diff-viewer`, `.diff-removed`, `.diff-added`, `.confirmation-gate`, `.confirmation-btn`, `.semantic-commit-modal`.
- **[2026-03-13]** Wired Episode Ingestion into `pipeline.ts`: auto-ingests resolved annotations into GraphRAG after resolution.
- **[2026-03-13]** Replaced keyword-based cascade check in `ResolutionActions.tsx` with `runCascadeCheck()` from GraphRAG. `show-cascade` action now queries knowledge graph first, falls back to LLM thread. Toast shows source ("knowledge graph" vs "keyword analysis") + affected entity names.
- **[2026-03-13]** Added `ingestEditEpisode()` call to `ResolutionActions.tsx` apply-edit handler for graph tracking.
- **[2026-03-13]** Updated `.env` and `.env.local.example` with FalkorDB, Graphiti LLM, and MCP server variables.
- **[2026-03-13]** Wired MADS into `resolveAnnotation()` in `resolver.ts`: complex intents route through `runMADS()`, simple intents fall back to single-agent.
- **[2026-03-13]** Upgraded `/api/resolve` route to support `logprobs: true` request param. OpenAI path requests `top_logprobs: 5`. Claude returns `logprobs: null`.
- **[2026-03-13]** Added `responseId` (UUID) generation to `/api/resolve` route for audit traceability. Returned in all responses.
- **[2026-03-13]** Wired audit logging into `resolver.ts`: both MADS and single-agent resolution paths now call `logResolutionAudit()` (non-blocking). Added `auditId` to `Resolution` type.
- **[2026-03-13]** Wired human oversight into `ResolutionActions.tsx`: every action (apply/dismiss/tweak/etc.) logs a human decision via `recordHumanDecision()`.
- **[2026-03-13]** Changed `Resolution.auditLog` from singular `AuditLog?` to plural `AuditLog[]` in Prisma schema (supports multiple audit entries per resolution including overrides).

### Fixed
- Eliminated immediate UI popups for AI flags, adopting "Event Segmentation Theory" to buffer notifications until natural reading breakpoints.

## [2026-06-29] v8.3 — Model/API Refresh + In-IDE Multi-Region Agent Edits (Waves 1-3)

### Added
- **[Wave 1] `src/lib/ai/modelCapabilities.ts`:** New `modelRejectsSampling(model)` helper — returns true for opus-4-7, opus-4-8, fable-5, and mythos. These models return HTTP 400 if sampling params (e.g. `temperature`) are sent. Single source of truth for the sampling-param gate.
- **[Wave 2] `.claude/agents/*.md` (8 roles):** orchestrator, architect, troublemaker, judge, qa, code-librarian, ui-ux, devops — now the authoritative runtime agent definitions.
- **[Wave 2] `.claude/skills/add-cascade-edit`:** New skill to scaffold the Wave 3 cascade-edit pattern (multi-region ProposedEdit producer + `propose_edit` structured route + read-line-aware decoration + sorted single transaction gated through SemanticCommitModal).
- **[Wave 3] `ProposedEdit` type in `src/lib/annotations/types.ts`:** `{ id, from, to, newText, reason, relation: 'primary' | 'cascade', status, targetText }`. Added `Resolution.edits?: ProposedEdit[]` and `Resolution.auditFailed?`.
- **[Wave 3] `src/app/api/structured/route.ts`:** New provider-agnostic tool-calling endpoint backing a `propose_edit` tool. Replaces the brittle regex `parseSuggestedEdit`.
- **[Wave 3] `src/lib/ai/orchestrator.ts`:** New `proposeCascadeEdits()` — upgrades the read-only cascade into editable multi-region proposals, anchored to live positions by fingerprint match (drops unanchorable / overlapping ones).
- **[Wave 3] `src/lib/prosemirror/plugins/proposedChangePlugin.ts`:** New "called out" decoration plugin — proposed changes are flagged above the read-line ("you already read this changed") and shown quietly below; positions re-mapped through `tr.mapping`. CSS added in `globals.css`.
- **[Wave 3] `src/lib/prosemirror/applyProposedEdits.ts`:** New validate-or-abort (fingerprint) + descending single-transaction apply helper.

### Changed
- **[Wave 1] `src/app/api/resolve/route.ts`, `src/app/api/classify/route.ts`, `src/app/api/generate/route.ts`:** Claude branch now omits `temperature` when `modelRejectsSampling(model)` is true. This was the real reason agent calls were failing on newer models.
- **[Wave 1] `src/stores/settingsStore.ts`:** Model list refreshed to Opus 4.8 / Fable 5 / Sonnet 4.6 / Haiku 4.5 (+ legacy Opus 4.6). Default remains Sonnet 4.6. New `normalizeClaudeModel()` migrates stale localStorage model IDs to Sonnet 4.6 (never silent-upgrades to Opus) via `onRehydrateStorage`.
- **[Wave 1] ApiKeyModal:** Now shows cost (multi-call) and diversity-disabled notices for Opus/Fable. Context compaction pinned to Haiku 4.5 regardless of the selected model.
- **[Wave 2] Root `agents.md`:** Demoted from authoritative config to a summary that points at `.claude/agents/*.md`. `build-wave` and `test` skills refreshed.
- **[Wave 3] `src/lib/ai/resolver.ts`:** Calls `proposeCascadeEdits()` on both MADS and single-agent paths to populate `Resolution.edits`.
- **[Wave 3] `src/lib/prosemirror/plugins/index.ts`:** Registered `proposedChangePlugin`.
- **[Wave 3] `src/components/Annotations/ResolutionActions.tsx`:** Multi-region apply now routes through `applyProposedEdits`.

### Fixed
- **[Wave 1] Newer-model agent calls returning 400:** Opus 4.8 / Fable 5 and other sampling-rejecting models no longer 400 because `temperature` is omitted for them. This was the underlying cause of failed agent calls after the model bump.
- **[Wave 3] Stale-position apply bug:** Multi-region apply previously read stale Zustand anchor positions; `applyProposedEdits.ts` now fingerprint-validates against live document text and applies in a single descending transaction.
- **[Wave 3] Silently-dropped audit records:** `logResolutionAudit` call sites now `.catch()` and set `resolution.auditFailed`, so EU AI Act audit failures are surfaced instead of swallowed.

### Verification
- `npm run typecheck` — 0 errors.
- `npm run test` — 194 passing (was 152; +42 new for `modelCapabilities` + settings migration).
- `npm run build` — clean.
- Project initialized as a git repo on `main` with two commits: "Initial commit: Intent IDE v8.2 + model/API refresh (Wave 1)" and "Waves 2-3: swarm agents, skills, and in-IDE multi-region agent edits". Secret hygiene verified before any commit: `.gitignore` covered `.env` from the start and no secret value ever entered git history.

## [2026-06-29] v8.3 — Wave 3 Refinements: Reviewable Multi-Region Edits

Multi-region proposed edits are now genuinely reviewable instead of all-or-nothing / bypassing the commit modal. All three surfaces share ONE source of truth: the `proposedChangePlugin` per-edit status (`setProposedEditStatus` / `getProposedAnchors`). The commit modal is authoritative at apply time.

### Added
- **`src/components/Editor/ProposedEditControl.tsx` + `src/stores/proposedEditUiStore.ts`:** Inline floating Accept/Reject control rendered on each called-out region. Status-only — actual document mutation is deferred to the batched apply.
- **`src/components/Annotations/CascadeList.tsx`:** Navigable cascade review list ("affects N sections") with click-to-scroll and per-row Accept/Reject. Rendered in `AnnotationCard.tsx`, replacing the throwaway cascade toasts.

### Changed
- **`src/lib/prosemirror/plugins/proposedChangePlugin.ts`:** Gained `handleDOMEvents`. `buildDecorations` now skips rejected regions and greys accepted ones (`proposed-accepted` class).
- **`src/components/Editor/SemanticCommitModal.tsx`:** Now renders per-change Accept/Reject toggles when there is >1 change, exposes `onConfirm(acceptedIds: string[])`, and seeds `initialRejected` from the live plugin status.
- **`src/components/Annotations/ResolutionActions.tsx`:** Routes the multi-edit case through `SemanticCommitModal` (the direct-apply bypass is removed) and applies only the accepted subset via `applyProposedEdits(view, acceptedIds)`.
- **`src/components/Annotations/AnnotationCard.tsx`:** Owns the decoration review lifecycle — `useEffect` shows proposed-edit decorations while the card is active + `status==='resolved'` + `edits.length>1`, and clears them on apply / dismiss / deactivate. Renders `CascadeList`.

### Fixed (Troublemaker review before commit)
- **Stale "Pending" after apply:** `CascadeList` (and the decorations) are gated on `status==='resolved'`, not on activity alone.
- **Inconsistent change-entry old range:** Multi-region change-entry now records the consistent old range (`ap.to`).
- **Two-click decoration switch / accidental dismiss:** Inline control switches decorations in one click; outside-click handlers ignore `[data-proposed-edit-id]` so clicking a region's own control does not dismiss it.
- **Empty acceptance:** Defensive guard for an empty `acceptedIds` set on apply.
- Troublemaker confirmed the two headline risks — source-of-truth divergence and an anchor-read-before-clear race — are NOT bugs.

### Verification
- `npm run typecheck` — 0 errors.
- `npm run test` — 194 passing.
- `npm run build` — clean.
- Committed and pushed to GitHub `Vinylfigure/intent-ide` `main` ("Wave 3 refinements: reviewable multi-region edits"). Pre-push secret audit re-confirmed no secret value exists anywhere in git history.

## [2026-03-16] Phase 14 — Bug Fixes and UX Hardening

### Added
- **[14C2] `src/components/Editor/FormattingToolbar.tsx`:** New formatting toolbar with Bold/Italic/Code/H1-H3/Lists/Blockquote buttons. Keybindings: Mod-b (bold), Mod-i (italic), Mod-` (code).
- **[14A3] Scroll-to-annotation event:** Custom `scroll-to-annotation` event dispatched on sub-annotation creation, listened by AnnotationPanel for auto-scroll to new annotations.
- **[14A3] Toast on sub-annotation creation:** User feedback when a drill action creates a child annotation.

### Changed
- **[14A1] `src/stores/documentStore.ts`:** `onRehydrateStorage` now normalizes legacy documents missing `collectionIds` to `[]`.
- **[14A1] `src/components/Layout/DocumentHubSidebar.tsx`:** All `doc.collectionIds` access sites now use defensive `(doc.collectionIds ?? [])`.
- **[14A2] `src/stores/changesStore.ts`:** Added `partialize` (caps entries at 500, changeSets at 100, excludes snapshots). Custom storage wrapper with `try/catch` for localStorage quota errors and emergency pruning fallback.
- **[14A3] `src/components/Annotations/ConversationThread.tsx`:** Drill-action intent changed from hardcoded `'flag'` to `suggestedIntent ?? 'dig'`.
- **[14B1] `src/lib/prosemirror/plugins/contextMenuPlugin.ts`:** Added mouseup and keyboard selection handlers so FloatingIconBar appears on any text selection, not just right-click.
- **[14B2] `src/components/Layout/AppShell.tsx`:** Auto-selects most recent document instead of showing DocInputModal when documents already exist.
- **[14B3] `src/components/Annotations/AnnotationCard.tsx`:** `onClick` handler moved from outer div to header row only; card body clicks no longer toggle expand/collapse.
- **[14B4] `src/components/Layout/AppShell.tsx`:** Right sidebar wrapper changed to `overflow-hidden`; each panel (DocumentHubSidebar, ChangesPanel, AuditLogViewer) now manages its own `overflow-y-auto`.
- **[14C1] `src/components/Changes/ChangeEntry.tsx`:** Now uses DiffView component with line numbers, per-entry expand/collapse, and position ranges.
- **[14C1] `src/components/Changes/DiffView.tsx`:** Enhanced diff visualization component.
- **[14C3] `src/components/Layout/DocumentHubSidebar.tsx`:** Section headers/timestamps/counts bumped from `text-[10px] text-muted-foreground` to `text-xs text-ink/50-60`.
- **[14C4] `src/components/Annotations/AnnotationPanel.tsx`:** Scroll-to-annotation listener added. Annotation click-to-scroll uses TextSelection fallback.
- **[14C4] `src/components/Annotations/AnnotationCard.tsx`:** Anchor preview changed from "on:" label to clickable quoted excerpt.
- **[14B1] `src/lib/prosemirror/plugins/index.ts`:** Plugin bundle updated for new contextMenuPlugin behavior.
- **[14A3/14C4] `src/lib/voice/pipeline.ts`:** Updated for drill-action intent and scroll event coordination.
- **[14C2] `src/components/Editor/EditorShell.tsx`:** Formatting toolbar integrated into editor view.

### Fixed
- **[14A1] DocumentHubSidebar crash:** Documents with missing `collectionIds` (legacy data) no longer crash the sidebar with "Cannot read properties of undefined (reading 'includes')".
- **[14A2] changesStore localStorage overflow:** Store no longer crashes when localStorage quota is exceeded; emergency pruning clears oldest entries automatically.
- **[14A3] Drill-action always producing 'flag' annotations:** Sub-annotations from drill actions now use the contextually appropriate intent type.
- **[14B2] New-document modal on startup with existing docs:** App no longer shows an empty modal when the user already has documents.
- **[14B3] Accidental annotation collapse on body click:** Clicking within the annotation card body (e.g., to interact with resolution content) no longer collapses the card.
- **[14B4] Double scrollbar in right panel:** Nested scrolling eliminated; each panel scrolls independently without a parent scrollbar.

## [2026-03-16] Reliability-First UX Overhaul — COMPLETE (Wave 4 + Troublemaker Bug Fixes)

### Added
- **[Wave 4A] Gated apply for high-risk edits in `src/components/Editor/SemanticCommitModal.tsx`:** New `provocation` and `isHighRisk` props. When `usedMADS=true` and a provocation exists, the Apply button is gated — user must click "I've considered this -- proceed" before Apply enables. Provocation shown as amber callout with warning icon.
- **[Wave 4B] `extractProvocation()` in `src/lib/ai/mads.ts`:** Extracts the strongest Troublemaker challenge from the CHALLENGES section when Judge verdict is MODIFY or REJECT. Returns null for APPROVE verdicts or when no challenges found.
- **[Wave 4B] `provocation` and `usedMADS` fields on Resolution interface in `src/lib/annotations/types.ts`:** Tracks whether MADS was used and what the strongest dissenting concern was.
- **[Wave 4B] Inline provocation callout in `src/components/Annotations/AnnotationCard.tsx`:** Amber-bordered callout shown when resolution has a provocation. "Tell me more" button triggers a follow-up about the concern.
- **[Wave 4B] Provocation pass-through in `src/components/Annotations/ResolutionActions.tsx`:** Passes `provocation` and `isHighRisk` to SemanticCommitModal.

### Fixed
- **[Troublemaker Fix 1] Classification wired in `createAnnotationFromText`:** `classifyAnnotation()` now called before creating the annotation. Previously, all annotations were permanently classified as 'flag'.
- **[Troublemaker Fix 2] Regenerate reads fresh annotation from store:** Fixed stale closure bug where Regenerate button used outdated annotation data instead of reading from annotationStore.
- **[Troublemaker Fix 3] Parent-child linkage uses real child ID:** Removed phantom 'pending' entry from childIds array. Linkage now handled inside `createAnnotationFromText` after the real ID is known.
- **[Troublemaker Fix 4] MADS_ACTIONS updated to new 4-type keys:** Changed from old 6-type keys (correction/restructure/fix/thought) to new 4-type keys (edit/flag) to match the consolidated type system.
- **[Troublemaker Fix 5] parseSuggestedEdit gated behind edit type:** `parseSuggestedEdit` now only runs when `annotation.type === 'edit'`, preventing non-edit annotations from being incorrectly parsed for suggested edits.
- **[Troublemaker Fix 6] Regenerate button disabled while resolving:** Added `disabled` guard to prevent double-click race condition during resolution.

## [2026-03-16] Reliability-First UX Overhaul — Wave 3 (Recursive Drilling + Verbosity Control + Annotation Map)

### Added
- **[Wave 3A] Interactive mode in `src/components/ui/AgentMarkdown.tsx`:** New `interactive` and `onDrill` props. When `interactive=true`, markdown body is split into paragraph-level clickable blocks. Each block has hover highlight and "click to drill" hint. Clicking opens a DrillMenu (positioned at click point) with 3 actions: "Dig deeper", "What's this mean?", "Edit this". Paragraph-level granularity chosen because it is native to the markdown AST, avoiding fragile sentence splitting.
- **[Wave 3B] `Verbosity` type in `src/lib/annotations/types.ts`:** New `Verbosity = 'concise' | 'normal' | 'detailed'` type. `verbosity: Verbosity` field added to the `Annotation` interface.
- **[Wave 3B] Verbosity engine in `src/lib/ai/resolver.ts`:** `VERBOSITY_MULTIPLIER` map (concise=0.5x, normal=1x, detailed=2x) applied to token limits. `VERBOSITY_INSTRUCTIONS` map appended to prompts. Wired into `resolveAnnotation`, `streamResolveAnnotation`, and `continueThread`.
- **[Wave 3B] Verbosity toggle in `src/components/Annotations/AnnotationCard.tsx`:** Short/Normal/Long toggle buttons. "Regenerate" button appears when verbosity differs from normal, re-runs resolution with current verbosity setting.
- **[Wave 3C] `src/components/Annotations/AnnotationMap.tsx`:** New vertical minimap component. Colored dots per annotation at proportional document position. Click dot scrolls editor and activates annotation. Legend shows type counts.
- **[Wave 3C] List/map toggle in `src/components/Annotations/AnnotationPanel.tsx`:** Panel header now has list icon / map icon toggle. Count indicator shows total annotations. Updated empty state text.

### Changed
- **[Wave 3A] `src/components/Annotations/ConversationThread.tsx`:** Wired AgentMarkdown interactive mode. On drill action, creates a child annotation via `createAnnotationFromText` using the parent's anchor positions. Child linked to parent via `parentId`/`childIds`.
- **[Wave 3B] `src/lib/voice/pipeline.ts`:** New annotations now default to `verbosity: 'normal'`.

## [2026-03-16] Reliability-First UX Overhaul — Wave 2 (4-Intent System + Invisible Classification)

### Added
- **[Wave 2A] `LegacyAnnotationType` and `mapLegacyType()` in `src/lib/annotations/types.ts`:** Backward-compatible type migration from 6-type system (question->ask, fix/correction/restructure->edit, explore->dig, thought->flag).
- **[Wave 2A] `ANNOTATION_DESCRIPTIONS` in `src/lib/annotations/types.ts`:** Human-readable descriptions for each of the 4 types.
- **[Wave 2A] `migrateAnnotations()` in `src/stores/annotationStore.ts`:** Runs on store rehydration to auto-migrate legacy 6-type annotations to 4-type system.
- **[Wave 2B] Clickable badge override in `src/components/Annotations/AnnotationCard.tsx`:** Click type badge -> dropdown with 4 types. Non-mutating overrides (ask<->dig, dig<->flag) relabel only. Mutating overrides (anything<->edit) re-run resolution via `streamResolveAnnotation`.
- **[Wave 2D] New CSS classes:** `annotation-ask`, `annotation-edit`, `annotation-dig`, `annotation-flag` in `globals.css`. New Tailwind color tokens in `tailwind.config.ts`. Legacy classes and tokens retained for backward compat.

### Changed
- **[Wave 2A] `src/lib/annotations/types.ts`:** `AnnotationType` union changed from `'question' | 'fix' | 'correction' | 'restructure' | 'explore' | 'thought'` to `'ask' | 'edit' | 'dig' | 'flag'`. New color scheme: ask=blue, edit=red, dig=purple, flag=amber.
- **[Wave 2A] `src/stores/agentConfigStore.ts`:** `DEFAULT_CONFIGS` updated to 4 types.
- **[Wave 2A] `src/lib/annotations/actions.ts`:** `ACTIONS_BY_TYPE` updated to 4 types.
- **[Wave 2A] `src/lib/prosemirror/decorations.ts`:** `typeClasses` updated to 4 types.
- **[Wave 2A] `src/lib/prosemirror/schema.ts`:** Default annotation type changed from `'question'` to `'ask'`.
- **[Wave 2B] `src/components/Editor/FloatingIconBar.tsx`:** Complete rewrite — removed 6-icon type picker, replaced with clean single input bar (text field + mic button + submit button). User types naturally, AI classifies.
- **[Wave 2B] `src/lib/voice/pipeline.ts`:** Removed post-recording type picker. Voice flow simplified to: record -> transcribe -> createAnnotationFromText (no ActionPicker step). Removed classifier import and settingsStore dependency.
- **[Wave 2B] `src/lib/ai/classifier.ts`:** Updated to classify into ASK/EDIT/DIG/FLAG (4-type prompt).
- **[Wave 2B] `src/app/api/classify/route.ts`:** `VALID_TYPES` updated to new 4 types.
- **[Wave 2C] `src/lib/ai/prompts.ts`:** New 4-type `CLASSIFICATION_PROMPT`. Merged fix/correction/restructure into single `edit` TYPE_PROMPT. All type prompts now ask/edit/dig/flag.
- **[Wave 2C] `src/lib/ai/resolver.ts`:** `ACTIONS_BY_TYPE` updated to 4 types. Edit-type detection simplified from triple OR to single `annotation.type === 'edit'`. Default fallback changed from `thought` to `flag`.
- **[Wave 2C] `src/lib/ai/mads.ts`:** `classifyComplexity` updated: `edit` -> complex (MADS), `ask`/`dig` -> simple, `flag` -> LLM-classified.
- **[Wave 2D] `src/components/Settings/AgentConfigPanel.tsx`:** `BUILTIN_TYPES` updated to 4 types.
- **[Wave 2D] `src/components/Annotations/ConversationThread.tsx`:** `SPIN_OFF_TYPES` updated to 4 types.
- **[Wave 2D] `src/lib/ai/__tests__/prompts.test.ts`:** Test expectations updated for 4-type system.

### Removed
- **[Wave 2A] `ANNOTATION_ICONS`:** Icon map removed from `types.ts` (no longer needed with invisible classification UX).

## [2026-03-16] Reliability-First UX Overhaul — Wave 0 + Wave 1

### Added
- **[Wave 0] AGENTS.md:** Multi-agent swarm configuration at project root. 10 roles (Orchestrator, PM, Architect, UI-UX Specialist, Optimizer, Troublemaker, Judge, Security Auditor, QA, DevOps, Code Librarian), agent-to-tool mapping table, and 7-step workflow protocol.
- **[Wave 1A] `src/stores/documentStore.ts`:** New flat document hub replacing project-folder model. Auto-save with 5-second debounce, recent docs (sorted by updatedAt, max 20), localStorage content storage under `intent-ide-doc:{id}` keys. Tracks `lastSavedAt`, `isDirty`, `activeDocumentId`.
- **[Wave 1E] `src/components/Annotations/ResolutionProgress.tsx`:** 3-stage progress bar — "Understanding your intent..." (classifying), "Analyzing context..." (resolving), "Writing response..." (streaming).

### Changed
- **[Wave 1A] `src/components/Editor/EditorShell.tsx`:** Restores active document from documentStore on mount. Auto-saves on `docChanged` ProseMirror transactions via debounced save.
- **[Wave 1A] `src/components/Layout/AppShell.tsx`:** Only shows DocInputModal when no active document exists. Added `beforeunload` warning when document is dirty. Added save status indicator ("Saved" / "Saving..." / "Unsaved changes").
- **[Wave 1A] `src/components/DocInput/DocInputModal.tsx`:** All import paths (paste, file upload, URL) now save to documentStore.
- **[Wave 1B] `src/lib/docInput/parser.ts`:** Full rewrite — now handles bullet lists, ordered lists, multi-line blockquotes, pipe-table detection, and HTML table/list conversion. Fixes "black bars" and broken rendering.
- **[Wave 1C] `src/app/globals.css`:** `--muted-foreground` boosted from `30 6% 45%` to `30 8% 32%` (~6:1 contrast ratio, WCAG AA compliant). All hardcoded `#7a756d` instances replaced with `hsl(var(--muted-foreground))` CSS variable.

### Fixed
- **[Wave 1D] Apply button:** Now idempotent — disabled after applied status. No longer deletes content on double-click due to stale ProseMirror positions.
- **[Wave 1D] Add to doc button:** Deterministic insertion contract — if `suggestedEdit` exists, applies at mapped position; otherwise inserts `resolution.content` as new paragraph after annotation's `to` position. Always creates a transaction. Disabled after success.
- **[Wave 1D] Keep digging button:** Seeds conversation with initial resolution message before adding follow-up. Always opens/extends thread. No longer silently fails on empty conversation array.
- **[Wave 1D] Tweak it button:** Shows inline text input ("How should I tweak this?") instead of auto-sending canned message. Requires explicit user input.
- **[Wave 1D] Follow-up button:** Now renders `FollowUpInput` consistently for all annotation states, including backward-compat path.
- **[Wave 1D] Show affected button:** Injects cascade results as conversation message (persistent, scrollable). Also scrolls editor to conflict decorations. No longer only shows transient toast.

## [2026-03-16] Phase 8 — Coherent Document Navigation and Annotation Review

### Added
- **`CollectionMeta` and collection-aware `DocumentMeta` in `src/stores/documentStore.ts`:** Documents now carry `collectionIds`, and the store supports create/rename/delete/assign/remove actions for collections.
- **Legacy project migration in `src/stores/documentStore.ts`:** One-time import from `intent-ide-projects` into the flat document hub, with id-first and fingerprint dedupe plus a persisted migration marker.
- **`src/components/Layout/DocumentHubSidebar.tsx`:** New document hub UI with all-documents list, collapsible collections, rename/duplicate/delete actions, and per-document collection assignment.
- **`documentId` and `locationGroupKey` on `Annotation` in `src/lib/annotations/types.ts`:** Gives the annotation layer stable active-document filtering and location grouping.
- **`getDefaultVerbosity()` in `src/lib/annotations/types.ts`:** Encodes adaptive-concise defaults (`section + dig` -> normal, all other new annotations -> concise).
- **`src/components/Annotations/AnnotationComposer.tsx`:** Shared input/chips/mic composer used across selection capture, thread drilling, and spin-off annotation flows.
- **`ChangeSet` model in `src/lib/changes/changeLog.ts` + `src/stores/changesStore.ts`:** Lightweight grouped review object keyed by root annotation thread, with annotation IDs, change entry IDs, audit IDs, title, status, and timestamp.
- **Phase 8 unit tests:** `documentStore.phase8.test.ts` and `changesStore.phase8.test.ts`.

### Changed
- **`src/components/Layout/AppShell.tsx`:** `Projects` tab replaced with `Documents`, left review sidebar can now collapse/expand, and toolbar shows the active document title.
- **`src/components/Editor/EditorShell.tsx`:** Explicitly flushes pending saves and loads the selected document when `activeDocumentId` changes after mount.
- **`src/components/DocInput/DocInputModal.tsx`:** Supports blank/paste/generate/import modes with explicit title and optional initial collection assignment.
- **`src/components/Editor/FloatingIconBar.tsx`:** Replaced bespoke selection input with `AnnotationComposer`.
- **`src/components/ui/AgentMarkdown.tsx`:** Replaced DrillMenu-only flow with `AnnotationComposer` anchored to clicked response blocks.
- **`src/components/Annotations/ConversationThread.tsx`:** Replaced spin-off input/type picker with `AnnotationComposer`.
- **`src/components/Annotations/AnnotationPanel.tsx`:** Rebuilt as a grouped, location-first review panel scoped to the active document. Minimap demoted to `Map (beta)`.
- **`src/components/Changes/ChangesPanel.tsx`:** Now leads with grouped change-set summary cards and separates ungrouped direct edits.
- **`src/components/Annotations/AuditLogViewer.tsx`:** Reframed as raw audit detail rather than the primary review surface.
- **`src/lib/voice/pipeline.ts`:** New annotations carry `documentId`, `locationGroupKey`, adaptive default verbosity, change-set linkage, and classification hints.
- **`src/lib/ai/resolver.ts`:** Uses adaptive verbosity resolution and links audit IDs back into change sets.
- **`vitest.config.ts`:** Unit tests are now scoped to repo-owned `src/**/*.test.*` files and exclude Playwright/dependency suites.

### Fixed
- **Active-document switching regression:** The editor now actually swaps document content when the user activates a different document from the sidebar.
- **Flat-vs-project split-brain:** The shipped UI path no longer depends on `projectStore` for live document navigation.
- **Flat change log noise:** Review now happens at a grouped change-set level before drilling into raw events.

## [2026-03-16] Phase 13 — Visual Hardening

### Added
- **Surface styling primitives in `src/app/globals.css`:** New app-shell, panel, topbar, editor-stage, editor-paper, and status-chip styles for a more intentional visual hierarchy.

### Changed
- **`src/components/Layout/AppShell.tsx`:** Warmer shell backdrop, stronger top bar, “Review Studio” identity chip, improved active-document badge, and staged editor canvas.
- **`src/components/Layout/StatusBar.tsx`:** Flat text replaced with discrete status chips for annotations, change sets, changes, provider, and voice shortcut.
- **`src/components/Layout/DocumentHubSidebar.tsx`:** Buttons, cards, collection sections, and document rows now have stronger shape, spacing, and hover states.
- **`src/components/Annotations/AnnotationPanel.tsx`:** Group cards and header controls now use clearer contrast and stronger anchor/status framing.
- **`src/components/Annotations/AnnotationCard.tsx`:** Active state, status badges, anchor preview, provocation block, and verbosity controls now have clearer visual hierarchy.
- **`src/components/Changes/ChangesPanel.tsx` and `src/components/Changes/ChangeEntry.tsx`:** Change-set cards and diff rows now have better separation and scanability.
- **`src/components/Annotations/AuditLogViewer.tsx`:** Audit detail cards now visually match the hardened review surfaces.
