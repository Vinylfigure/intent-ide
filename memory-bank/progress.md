# Progress Tracker: Intent IDE (v8.4 merged + Cascade v2 candidates)

## 1. High-Level Status
**Current Phase:** Cascade v2 — Waves A (Precision + Live Eval) and E (Git-Model Document History + EU AI Act) BUILT and reviewed, open as **PR #5** and **PR #6** (pending merge). Waves B (scale/recall), C (trust/UX), D (consolidation) remain per the roadmap plan (`/Users/a/.claude/plans/do-this-users-a-documents-code-ide-docs-warm-liskov.md`).
**Overall Completion:** Core architecture (5 phases) complete. Reliability-First UX Overhaul complete. Phases 8, 13, and 14 complete. v8.3 model/API refresh + in-IDE multi-region agent edits complete. v8.4 Precision-First Cascade Graph MERGED to `main` via PR #4. Test counts: `main` = 287 passing; PR #5 branch = 322 passing + 10 skipped (opt-in live bench); PR #6 branch = 335 passing.
**System Status:** Alpha / Core systems built, crash-free, and interaction-complete. Published on GitHub at `Vinylfigure/intent-ide`. The cascade — the product's differentiating primitive — is no longer a whole-doc-truncated LLM pass: it is graph-scoped over a block-keyed document dependency graph (`docGraph.ts`) anchored on stable `blockId` attrs, with evidence-gated, derived severity (`must`/`probably`/`optional`) rendered across all three review surfaces, and an EditPropBench-grounded eval harness gating regressions. The `.slice(0, 6000)` doc truncation is gone. All prior guarantees hold: HITL commit gate, validate-or-abort single-transaction apply, provider-agnostic `/api/structured`.

---

## 2. Completed Milestones (What Works)

### Cascade v2 — Waves A + E (PRs #5, #6 open) -- BUILT + ADVERSARIALLY REVIEWED, pending merge
Two waves of the Cascade v2 roadmap, built in parallel git worktrees (`../IDE-wave-a`, `../IDE-wave-e`) off merged PR #4, each through a full implement → adversarial-review → fix cycle. Both Troublemaker reviews returned NO-MERGE with HIGH findings; all findings were fixed BEFORE the PRs were opened. Roadmap plan: `/Users/a/.claude/plans/do-this-users-a-documents-code-ide-docs-warm-liskov.md`.

#### Wave A — Precision + Live Eval (PR #5, branch `claude/cascade-v2-a`, 7 commits)
- [x] **A1 — Relevance judge:** New `src/lib/ai/relevanceJudge.ts` — batched LLM judge verifying that `must`-candidates' citations GENUINELY conflict (closes the `hasVerbatimConflict` existence-vs-relevance gap). Target block context is included in the judge input; the judge can only LOWER severity, never raise it; the judge prompt contains no severity vocabulary.
- [x] **A2 — Judge robustness semantics (Troublemaker review):** Judge malfunction — a thrown call OR a response with zero valid verdicts — PRESERVES the derived severities; only real per-candidate verdicts can demote. `maxTokens` scales with candidate count (fixed limits silently truncate the batch tail into wrong semantics). Deny-wins on duplicate verdict indexes.
- [x] **A3 — Utility-model routing:** `pickUtilityModel` in `src/lib/ai/modelCapabilities.ts` pins the relevance judge + context compaction to `claude-haiku-4-5` (claude provider only). Graph extraction deliberately STAYS on the user's selected model — it is a recall mechanism, not housekeeping.
- [x] **A4 — Transport resilience:** `fetchWithRetry` in `src/lib/ai/structuredClient.ts` — retries 429/5xx, 2 retries, jittered backoff.
- [x] **A5 — Opt-in live bench:** `editPropBench.live.test.ts` + `npm run bench:live` (`BENCH_LIVE=1`, requires the dev server, preflight fail-fast, asserts a non-empty measurement, dumps results to gitignored `bench-results/`). Shows as 10 skipped tests in normal runs.
- [x] **A6 — Prompt-caching commit REVERTED in-branch:** Added, then review proved it a cost regression — zero shared prefix between the cascade and judge calls, the in-process content-hash cache already absorbs identical rebuilds, and the 2000-char trigger sat below Anthropic's 1024/2048-token cacheable minimum (cache writes carry a 1.25x surcharge with zero possible hits).
- [x] **Verification:** 322 tests passing + 10 skipped on the branch.

#### Wave E — Git-Model Document History + EU AI Act (PR #6, branch `claude/cascade-v2-e`, 7 commits)
- [x] **E1 — `DocCommit` Prisma model:** Migration `20260709205301_add_doc_commit_history`. The unused `DocumentSource` model was REMOVED — migration verified against a populated pre-existing DB.
- [x] **E2 — Two-level content addressing (git tree+commit):** `contentHash` = sha256(canonical docJson); commit `hash` covers documentId + parentHash + contentHash + kind + message + actor + annotationId + auditIds + modelVersion. Attribution lives INSIDE the address — review found content-only hashing let a racing 'direct' autosave silently absorb an 'apply' commit's AI provenance.
- [x] **E3 — Append-only `/api/history`:** POST create-only; server recomputes both hashes and 400s on mismatch; 409 stale-head enforces linearity (client rebase-retry-once); idempotent duplicates; no update/delete.
- [x] **E4 — `src/lib/history/`:** `canonical.ts`; `commits.ts` — `createCommit` (contentHash-dedupe, kind-aware), `blameBlock`, `restoreCommit` TRANSACTIONAL: flush pending edits → HUMAN_RESTORE audit event with its id embedded in the restore commit's `auditIds` → commit → only then dispatch `replaceWith` with `addToHistory: false`.
- [x] **E5 — Capture points:** 'import' root commit; 'apply' commits carry `blockIdsTouched` + `auditIds` + actor `ai+human` + `modelVersion`, with `ChangeSet.commitHash` linkage; 'direct' commits on autosave/doc-switch/unmount flushes.
- [x] **E6 — History UI:** `HistoryPanel.tsx` + AppShell History tab. Accessible language only (Version / Compare / Restore / "Last changed by"); pagination past 200; restore is Confirmation-gated (HITL).
- [x] **E7 — Phantom-entry fix:** `changeTrackingPlugin` now skips `addToHistory: false` transactions — no more phantom full-doc "Direct edit" entries on restore/doc-switch.
- [x] **E8 — `docs/compliance.md` HONEST framing:** application-enforced append-only; tamper-EVIDENT, not immutable; client-supplied attribution; the `auditFailed` → zero-audit-links case is disclosed.
- [x] **E9 — CI:** now runs `prisma migrate deploy`.
- [x] **Verification:** 335 tests passing on the branch.

#### Remaining Cascade v2 Waves (pending)
- [ ] **Merge PR #5 and PR #6** (then remove worktrees `../IDE-wave-a` and `../IDE-wave-e`).
- [ ] **Wave B — scale/recall.**
- [ ] **Wave C — trust/UX.**
- [ ] **Wave D — consolidation.**

### v8.4 — Precision-First Cascade Graph -- COMPLETE (PR #4, MERGED to `main`)
Built from `docs/fable5-cascade-brief.md` (local, untracked brief). Replaces the two disconnected cascade stubs (whole-doc-truncated LLM pass + Graphiti entity-mention firehose) with one precision-first document dependency graph. 8 commits (`d7e1a23..bafccea`) on branch `claude/cascade-graph`; `main` is branch-protected, so this lands via PR #4 (https://github.com/Vinylfigure/intent-ide/pull/4).

- [x] **T1 — Stable block IDs:** `schema.ts` `withBlockId` adds a persistent `blockId` attr to paragraph/heading/blockquote/code_block/list_item. `parseDOM` deliberately does NOT read `data-block-id`, so pasted content mints fresh ids (no cross-doc id collisions). New `src/lib/prosemirror/blockIds.ts` (`collectBlocks`/`collectTextblocks`/`findBlockById`/`blockIdAtPos`/`computeBlockIdFixes`/`blockTextRange`) + `plugins/blockIdPlugin.ts` — `appendTransaction` stamping; on duplicate ids (Enter mid-paragraph copies attrs) the keeper is the first NON-EMPTY occurrence; stamps ride the triggering history event; initial-load stamping deferred via `queueMicrotask` with `addToHistory: false`. `changeTrackingPlugin` skips `blockIdPluginKey` meta.
- [x] **T2 — ProposedEdit severity + evidence (additive):** `types.ts` gains `CascadeSeverity` (`'must' | 'probably' | 'optional'`), `CascadeEdgeType` (7 typed relations), `CascadeEvidence` (`{sourceBlockId, quotedText, edgeType} | null`), `blockId?`, `SEVERITY_ORDER`/`SEVERITY_LABELS`, and `normalizeProposedEdit()` (legacy primaries → `must`, legacy cascades → `probably`, no evidence) applied on `annotationStore` rehydration.
- [x] **T3 — Document dependency graph:** New `src/lib/graphrag/docGraph.ts` — block-keyed nodes, typed edges (`DocGraphEdgeSource = 'deterministic' | 'llm' | 'graphiti'`). Deterministic extractors (cross-refs→headings, defined terms, duplicated sentences) + ONE validated `link_blocks` LLM pass capped at `LLM_PASS_MAX_BLOCKS = 200` textblocks. FNV-1a `contentHash` LRU-8 cache with inflight dedupe. `getNeighborhood` BFS. `scheduleDocGraphRebuild` runs deterministic-only in the background — doc text never leaves the machine as a side effect of typing; the LLM pass runs lazily inside the user-initiated cascade. New `src/lib/ai/structuredClient.ts`: injectable `CallStructuredFn` seam; `fetchStructured` THROWS on `!res.ok` so "provider down" is never conflated with "no dependencies found" (cache-poisoning guard).
- [x] **T4 — Graph-scoped cascade:** `orchestrator.ts` `proposeCascadeEdits` rewritten — 2-hop neighborhood, `maxBlocks` 24 (block COUNT capped; block text never truncated), blockId-first anchoring via `blockTextRange` with a neighborhood-gated `findTextInDoc` fallback, first-proposal-wins overlap gate (duplicate tool calls were a corruption vector in the single descending apply transaction), evidence verified verbatim against the live doc, severity DERIVED (`deriveSeverity`/`hasVerbatimConflict`/`extractChangedTokens` with stopword filter + 2-char number floor) — never trusted from the model. `resolver.ts` `attachCascadeEdits`: the `.slice(0, 6000)` whole-doc truncation is DELETED.
- [x] **T5 — Severity UI (all three review surfaces):** `ProposedEditControl` (severity badge + evidence line), `CascadeList` (severity pill, sorted by `SEVERITY_ORDER`), `SemanticCommitModal` (severity/relation on `SemanticChange`, badges), `ResolutionActions` (rows primary-first then severity; accept-all defaults to `must`+`probably` — `optional` pre-toggled off unless accepted inline). `globals.css` `proposed-severity-*` variants.
- [x] **T6 — EditPropBench-grounded eval harness:** `src/lib/graphrag/__tests__/editPropBench.{fixtures,test}.ts` — 10 fixtures labeled direct-target / required-downstream / protected-unchanged (arXiv:2605.02083 — real, verified; the previously-circulating "LEDGER agentic editing" citation is FABRICATED, do not cite). Gates: recall ≥ 0.9, 0 false-positive violations, 100% citation validity. It is a pipeline regression gate (scripted model), NOT a model benchmark.
- [x] **T7 — Swarm review fixes:** CRITICAL editor mount crash (plugin `view()` dispatching during EditorView construction → TDZ on `const view` in EditorShell `dispatchTransaction`; fixed by `queueMicrotask` deferral) + new jsdom mount smoke suite `src/lib/prosemirror/__tests__/editorMount.smoke.test.ts` (jsdom added as devDependency). Doc-switch `replaceWith` now `addToHistory: false` (Cmd-Z could resurrect the previous doc and autosave it under the new doc's id). `applyProposedEdits` drift recovery is blockId-scoped first. `contentHash` separator sentinels (u0001/u0002) rewritten from raw invisible control bytes embedded in the source literal to visible backslash-escaped forms.

#### Verification
- [x] **`npm run typecheck`** — 0 errors. **`npm run lint`** — clean. **`npm run build`** — clean.
- [x] **`npm run test`** — 287 passing (was 194; +93 incl. blockIds, blockIdPlugin, docGraph, editPropBench, editorMount smoke).
- [x] **EditorShell** wires `scheduleDocGraphRebuild` + `cancelScheduledDocGraphRebuild`.
- [x] **Git:** 8 commits on `claude/cascade-graph`; PR #4 MERGED to `main` (2026-07-09). `main` = 287 tests.

### v8.3 — Model/API Refresh + In-IDE Multi-Region Agent Edits (Waves 1-3) -- COMPLETE

#### Wave 1 — Model/API Refresh
- [x] **W1-1 — Model capability gate:** New `src/lib/ai/modelCapabilities.ts` with `modelRejectsSampling(model)` returning true for opus-4-7/opus-4-8/fable-5/mythos. These models 400 on sampling params (`temperature`).
- [x] **W1-2 — Sampling-param omission:** Claude branch of `/api/resolve`, `/api/classify`, and `/api/generate` now omits `temperature` when `modelRejectsSampling(model)` is true. This was the real cause of agent-call failures on newer models.
- [x] **W1-3 — Model list refresh:** `settingsStore.ts` model list is now Opus 4.8 / Fable 5 / Sonnet 4.6 / Haiku 4.5 (+ legacy Opus 4.6). Default stays Sonnet 4.6.
- [x] **W1-4 — Safe migration:** `normalizeClaudeModel()` migrates stale localStorage model IDs to Sonnet 4.6 (never silent-upgrades to Opus) via `onRehydrateStorage`.
- [x] **W1-5 — Cost / diversity notices:** ApiKeyModal shows cost (multi-call) and diversity-disabled notices for Opus/Fable. Context compaction pinned to Haiku 4.5 regardless of the selected model.

#### Wave 2 — Agents & Skills
- [x] **W2-1 — Authoritative agent definitions:** `.claude/agents/*.md` (8 roles: orchestrator, architect, troublemaker, judge, qa, code-librarian, ui-ux, devops) are now the runtime agent definitions. Root `agents.md` demoted to a summary that points at them.
- [x] **W2-2 — New + refreshed skills:** New skill `.claude/skills/add-cascade-edit`. Refreshed `build-wave` and `test` skills.

#### Wave 3 — In-IDE Multi-Region Agent Edits (PRD Read-Line + Cascade, Sections 06-09)
- [x] **W3-1 — ProposedEdit type:** `src/lib/annotations/types.ts` gains `ProposedEdit` (`{id, from, to, newText, reason, relation: 'primary' | 'cascade', status, targetText}`), `Resolution.edits?: ProposedEdit[]`, and `Resolution.auditFailed?`.
- [x] **W3-2 — Structured tool-calling endpoint:** New `src/app/api/structured/route.ts` — provider-agnostic tool-calling endpoint backing a `propose_edit` tool. Replaces the brittle regex `parseSuggestedEdit`.
- [x] **W3-3 — Cascade-to-edit orchestrator:** New `src/lib/ai/orchestrator.ts` — `proposeCascadeEdits()` upgrades the read-only cascade into editable multi-region proposals, anchored to live positions by fingerprint match (drops unanchorable / overlapping ones). `resolver.ts` calls it on both MADS and single-agent paths to populate `Resolution.edits`.
- [x] **W3-4 — Called-out decorations plugin:** New `src/lib/prosemirror/plugins/proposedChangePlugin.ts` — flags proposed changes above the read-line ("you already read this changed") and shows them quietly below; positions re-mapped through `tr.mapping`. Registered in `plugins/index.ts`; CSS in `globals.css`.
- [x] **W3-5 — Validate-or-abort apply:** New `src/lib/prosemirror/applyProposedEdits.ts` — fingerprint validate-or-abort + descending single-transaction apply. Fixes a latent stale-position bug (apply previously read stale Zustand anchor positions). `ResolutionActions.tsx` routes multi-region apply through it.
- [x] **W3-6 — Audit durability:** `logResolutionAudit` call sites now have `.catch()` that sets `resolution.auditFailed`, so EU AI Act records are no longer dropped silently.

#### Verification
- [x] **`npm run typecheck`** — 0 errors.
- [x] **`npm run test`** — 194 passing (was 152; +42 new for modelCapabilities + settings migration).
- [x] **`npm run build`** — clean.
- [x] **Git:** Project is now a git repo on `main`. Two commits: "Initial commit: Intent IDE v8.2 + model/API refresh (Wave 1)" and "Waves 2-3: swarm agents, skills, and in-IDE multi-region agent edits". Secret hygiene verified before push: `.env` was never tracked and no secret value exists anywhere in git history.

### Phase 14 — Bug Fixes and UX Hardening -- COMPLETE
- [x] **14A1 — DocumentHubSidebar crash fix:** Defensive `(doc.collectionIds ?? [])` at all access sites + migration in documentStore `onRehydrateStorage` to normalize legacy docs missing `collectionIds`.
- [x] **14A2 — changesStore persistence hardening:** Added `partialize` (caps entries at 500, changeSets at 100, excludes snapshots), custom storage wrapper with localStorage quota error handling and emergency pruning.
- [x] **14A3 — Drill-action visibility fix:** Changed hardcoded `'flag'` to `suggestedIntent ?? 'dig'` in ConversationThread. Added toast on sub-annotation creation. Added `scroll-to-annotation` custom event + listener in AnnotationPanel.
- [x] **14B1 — Selection-triggered annotation entry:** Added mouseup and keyboard selection handlers to `contextMenuPlugin.ts` so FloatingIconBar appears on text selection (not just right-click).
- [x] **14B2 — Document modal startup fix:** Auto-selects most recent doc instead of showing new-document modal when docs exist.
- [x] **14B3 — Annotation expand/collapse restriction:** Moved `onClick` from outer div to header row only — card body clicks no longer toggle collapse.
- [x] **14B4 — Nested right-panel scrolling fix:** AppShell sidebar wrapper changed to `overflow-hidden`, each panel (DocumentHubSidebar, ChangesPanel, AuditLogViewer) given its own `overflow-y-auto`.
- [x] **14C1 — Changes panel improvements:** ChangeEntry now uses DiffView with line numbers, per-entry expand/collapse, position ranges.
- [x] **14C2 — Formatting toolbar:** New `FormattingToolbar.tsx` with Bold/Italic/Code/H1-H3/Lists/Blockquote + Mod-b/Mod-i/Mod-` keybindings.
- [x] **14C3 — Document hub readability:** Bumped section headers/timestamps/counts from `text-[10px] text-muted-foreground` to `text-xs text-ink/50-60`.
- [x] **14C4 — Annotation click-to-scroll and anchor clarity:** Improved scroll with TextSelection fallback, replaced "on:" anchor preview with clickable quoted excerpt.

### Phase 13 — Visual Hardening -- COMPLETE
- [x] **13A — Surface hierarchy:** `globals.css` now provides app-shell, panel, topbar, and editor-stage surface styles with warmer gradients and clearer contrast.
- [x] **13B — Layout polish:** `AppShell.tsx` now presents a more intentional top bar, staged editor canvas, and cleaner collapsed-sidebar affordance.
- [x] **13C — Review panel styling:** `AnnotationPanel.tsx`, `AnnotationCard.tsx`, `ChangesPanel.tsx`, `ChangeEntry.tsx`, `DocumentHubSidebar.tsx`, and `AuditLogViewer.tsx` now use stronger cards, badges, chips, and spacing.
- [x] **13D — Status readability:** `StatusBar.tsx` now exposes annotations, change sets, changes, provider, and voice hotkey as discrete chips instead of flat muted text.

### Phase 8 — Coherent Document Navigation and Annotation Review -- COMPLETE
- [x] **8A — Flat document hub + collections:** `documentStore.ts` is the active document source of truth, with `CollectionMeta`, document `collectionIds`, legacy project migration, duplicate dedupe, and explicit create/rename/duplicate/delete/move actions.
- [x] **8B — Document hub navigation:** `DocumentHubSidebar.tsx` replaced the project UI path. AppShell now shows a `Documents` tab and supports sidebar collapse/expand without losing tab state.
- [x] **8C — Active document switching:** `EditorShell.tsx` now flushes pending saves and loads the selected document when `activeDocumentId` changes after mount.
- [x] **8D — Fresh-document creation:** `DocInputModal.tsx` now supports blank/paste/generate/import creation with explicit title and optional initial collection.
- [x] **8E — Shared annotation composer:** One reusable composer powers selection capture, thread drilling, and spin-off annotation creation. Quick chips provide intent hints; mic stays in the same component.
- [x] **8F — Location-first annotation review:** `Annotation` now stores `documentId` and `locationGroupKey`. `AnnotationPanel.tsx` groups active-document annotations by location and nests thread descendants.
- [x] **8G — Adaptive concise default:** New annotations default to concise except `section + dig`, which defaults to normal. Regenerate only appears when the user diverges from the adaptive default.
- [x] **8H — Grouped change-set review:** `changesStore.ts` now tracks `ChangeSet`s keyed by root annotation thread. `ChangesPanel.tsx` leads with change-set summaries; raw audit remains separate.
- [x] **8I — Test runner hygiene:** `vitest.config.ts` now scopes unit tests to repo-owned test files, excluding Playwright and dependency suites.

### Core Architecture (Phases 1-5) -- All Complete
- [x] **Phase 1 — Foundation & Compliance:** Next.js 14 + shadcn/ui + Prisma v7 + SQLite + Graphiti MCP client.
- [x] **Phase 2 — Capture Layer (UI/UX):** ProseMirror editor, annotation highlighting, voice capture, conflict plugin, uncertainty plugin, impact analysis, Plan/Act diff viewer with HITL gate.
- [x] **Phase 3 — Semantic Memory (GraphRAG):** FalkorDB + Graphiti MCP server, episode ingestion, GraphRAG-powered cascade check with keyword fallback.
- [x] **Phase 4 — Agentic Orchestration (MADS):** LangGraph-style TypeScript state machine, 3-agent debate (Troublemaker/Peacemaker/Judge), token-level uncertainty via logprobs, context compaction.
- [x] **Phase 5 — Compliance & Audit:** 14-field audit schema, append-only audit logging, human oversight controls, HITL gates wired throughout.
- [x] **UI Polish & Testing:** Uncertainty tooltips, MADS debate collapsing, SSE streaming with Streamdown, HITL diff modal, audit log viewer, E2E tests.

### UX Overhaul — Reliability-First Pass
- [x] **Wave 0 — Swarm Configuration:** `AGENTS.md` created with 10 agent roles, tool mappings, and workflow protocol.
- [x] **Wave 1A — Document Persistence:** `documentStore.ts` (flat document hub, auto-save 5s debounce, localStorage content storage). EditorShell restores on mount. AppShell beforeunload + save status. DocInputModal saves to documentStore.
- [x] **Wave 1B — Import Fidelity:** `parser.ts` full rewrite — bullet lists, ordered lists, multi-line blockquotes, pipe-table detection, HTML table/list conversion.
- [x] **Wave 1C — Readability:** `--muted-foreground` boosted to 30 8% 32% (~6:1 contrast). All hardcoded #7a756d replaced with CSS variable.
- [x] **Wave 1D — Broken Buttons (all 6):** Apply (idempotent), Add to doc (deterministic insertion), Keep digging (seeds conversation), Tweak it (inline input), Follow-up (backward-compat), Show affected (cascade as conversation message).
- [x] **Wave 1E — Progress Indicator:** `ResolutionProgress.tsx` — 3-stage progress bar.

---

## 3. Roadmap & Pending Tasks (What's Left to Build)

### Cascade v2 Follow-ups (Pending)
- [x] **Merge PR #4:** MERGED to `main` (2026-07-09). Both Cascade v2 worktrees branched from the merged result.
- [ ] **Merge PR #5 (Wave A) and PR #6 (Wave E):** Open, CI running. PR #6's CI exercises `prisma migrate deploy` for the first time — watch it.
- [ ] **Remove worktrees `../IDE-wave-a` and `../IDE-wave-e`** after both PRs merge.
- [ ] **Waves B (scale/recall), C (trust/UX), D (consolidation)** per the roadmap plan at `/Users/a/.claude/plans/do-this-users-a-documents-code-ide-docs-warm-liskov.md`. Wave B starts in a fresh worktree after the merges.
- [ ] **Modal -> plugin write-back symmetry (carried from v8.3, now deeper):** Accept/reject toggles inside `SemanticCommitModal` still do not write back to the plugin status. The v8.4 optional-severity pre-toggle (optional edits default OFF in accept-all) deepens the asymmetry: the modal's initial state can now diverge from the inline controls in one more way.
- [ ] **>200-block docs get deterministic-only graph edges:** `LLM_PASS_MAX_BLOCKS = 200` skips the `link_blocks` LLM pass on very large docs; cascade recall there relies entirely on the deterministic extractors. Consider chunked/hierarchical LLM extraction later.
- [x] **`hasVerbatimConflict` existence-vs-relevance gap:** Closed on PR #5 by the batched relevance judge (`relevanceJudge.ts`) — `must`-candidates' citations are LLM-verified for genuine conflict; judge can only lower severity; malfunction preserves derived severities.
- [ ] **Proposal-position snapshot race (pre-existing, documented):** Proposal positions are captured against the resolution-start EditorState snapshot. If the user types during resolution, the review UI can highlight drifted ranges. The APPLY path is safe (validate-or-abort + blockId-scoped drift recovery); only the review-time visuals can drift.
- [ ] **Graphiti bridge (deferred by decision):** `graphrag/cascadeCheck.ts` was left untouched as the separate read-only entity lane. `DocGraphEdge.source` reserves `'graphiti'` for a future bridge feeding entity edges into the docGraph.
- [ ] **README screenshots** (public-release follow-up) and **rotate the live `GRAPHITI_LLM_API_KEY`** (was in gitignored `.env`; never entered git history — routine hygiene).
- [ ] **Local Whisper for fully-offline voice (optional):** Replace the hosted Whisper transcription with a local model for an end-to-end offline path.

### v8.3 Wave 3 Refinements — Reviewable Multi-Region Edits -- COMPLETE
All three follow-ups landed against ONE source of truth: the `proposedChangePlugin` per-edit status (`setProposedEditStatus` / `getProposedAnchors`). The plugin holds live per-region status; the commit modal is authoritative at apply time.
- [x] **Inline per-edit Accept/Reject UI:** New `src/components/Editor/ProposedEditControl.tsx` + `src/stores/proposedEditUiStore.ts`. Floating Accept/Reject control on each called-out region. `proposedChangePlugin` gained `handleDOMEvents`; `buildDecorations` now skips rejected regions and greys accepted ones (`proposed-accepted`). Status-only — actual mutation is deferred to the batched apply.
- [x] **Multi-diff SemanticCommitModal:** `src/components/Editor/SemanticCommitModal.tsx` now renders per-change Accept/Reject toggles when there is >1 change, exposes `onConfirm(acceptedIds: string[])`, and seeds `initialRejected` from the live plugin status. `src/components/Annotations/ResolutionActions.tsx` routes the multi-edit case through the modal (the old direct-apply bypass is removed) and applies only the accepted subset via `applyProposedEdits(view, acceptedIds)`.
- [x] **Navigable cascade review list:** New `src/components/Annotations/CascadeList.tsx` ("affects N sections", click-to-scroll, per-row Accept/Reject), rendered in `AnnotationCard.tsx`, replacing the throwaway cascade toasts.
- [x] **Decoration review lifecycle in `AnnotationCard.tsx`:** `useEffect` shows proposed-edit decorations while the card is active + `status==='resolved'` + `edits.length>1`, and clears them on apply / dismiss / deactivate.
- [x] **Troublemaker review (pre-commit):** CascadeList gated on `status==='resolved'` (fixes stale "Pending" after apply); multi-region change-entry records the consistent old range (`ap.to`); inline control switches decorations in one click (outside-click ignores `[data-proposed-edit-id]`); defensive empty-`acceptedIds` guard. Troublemaker confirmed the two headline risks (source-of-truth divergence, anchor-read-before-clear race) are NOT bugs.
- [x] **Verification:** `npm run typecheck` 0 errors, `npm run test` 194 passing, `npm run build` clean. Committed and pushed to GitHub `Vinylfigure/intent-ide` `main` ("Wave 3 refinements: reviewable multi-region edits").

### Wave 2: Single-Input Interaction Model + 4-Intent System -- COMPLETE
- [x] **2A — Type Consolidation (6 to 4):** New union `'ask' | 'edit' | 'dig' | 'flag'` in `types.ts`. `LegacyAnnotationType`, `mapLegacyType()`, new colors (ask=blue, edit=red, dig=purple, flag=amber), `ANNOTATION_DESCRIPTIONS`. Store migration via `migrateAnnotations()` on rehydrate. Updated `agentConfigStore.ts`, `actions.ts`, `decorations.ts`, `schema.ts`.
- [x] **2B — Invisible Classification:** `FloatingIconBar.tsx` rewritten as single input bar (text + mic + submit). Voice pipeline simplified (no ActionPicker). `AnnotationCard.tsx` badge clickable with dropdown override (non-mutating relabels, mutating re-resolves). `classifier.ts` and `/api/classify` updated for 4 types.
- [x] **2C — Routing & Prompts:** New 4-type `CLASSIFICATION_PROMPT`. Merged prompts into single `edit` TYPE_PROMPT. `resolver.ts` simplified edit detection. `mads.ts` complexity: `edit` -> MADS, `ask`/`dig` -> single-agent, `flag` -> LLM-classified.
- [x] **2D — Cleanup:** New CSS classes (annotation-ask/edit/dig/flag) and Tailwind tokens. Legacy kept for backward compat. Updated `AgentConfigPanel.tsx`, `ConversationThread.tsx`, `prompts.test.ts`. Removed `ANNOTATION_ICONS`.

### Wave 3: Recursive Review and Controllable Output -- COMPLETE
- [x] **3A — Recursive annotation drilling:** `AgentMarkdown.tsx` gained `interactive`/`onDrill` props. Paragraph-level clickable blocks with hover highlight. DrillMenu at click point with 3 actions: "Dig deeper", "What's this mean?", "Edit this". `ConversationThread.tsx` wired to create child annotations via `createAnnotationFromText` using parent's anchor positions, linked via `parentId`/`childIds`.
- [x] **3B — Response verbosity control:** `Verbosity = 'concise' | 'normal' | 'detailed'` type in `types.ts`. `VERBOSITY_MULTIPLIER` (0.5x/1x/2x) and `VERBOSITY_INSTRUCTIONS` in `resolver.ts`, applied in `resolveAnnotation`, `streamResolveAnnotation`, and `continueThread`. Default `verbosity: 'normal'` in `pipeline.ts`. Short/Normal/Long toggle and conditional Regenerate button in `AnnotationCard.tsx`.
- [x] **3C — Annotation sidebar map:** New `AnnotationMap.tsx` — vertical minimap with colored dots at proportional document positions. Click dot scrolls editor + activates annotation. Legend with type counts. `AnnotationPanel.tsx` has list/map toggle in panel header + count indicator.

### Wave 4: Positive Friction and Compliance -- COMPLETE
- [x] **4A — Gated apply for high-risk edits:** `SemanticCommitModal.tsx` gained `provocation` and `isHighRisk` props. When `usedMADS=true` and a provocation exists, Apply button gated behind explicit acknowledgment ("I've considered this -- proceed"). Provocation shown as amber callout with warning icon.
- [x] **4B — Inline provocations:** `extractProvocation()` in `mads.ts` extracts strongest Troublemaker challenge from CHALLENGES section when Judge verdict is MODIFY or REJECT. `provocation` and `usedMADS` added to Resolution interface. Inline amber callout on AnnotationCard with "Tell me more" button. ResolutionActions passes provocation/isHighRisk to SemanticCommitModal.
- [x] **4C — Cognitive bias mitigation:** Covered by 4A (gated apply friction) and 4B (inline provocations surfacing unresolved Troublemaker objections). The provocation mechanism is the primary cognitive bias mitigation tool.

### Troublemaker Bug Fixes (6 Critical) -- COMPLETE
- [x] **Classification wired in createAnnotationFromText:** Was permanently 'flag' before; now calls `classifyAnnotation()` before creating the annotation.
- [x] **Regenerate reads fresh annotation from store:** Fixed stale closure bug where Regenerate button used outdated annotation data.
- [x] **Parent-child linkage uses real child ID:** Removed phantom 'pending' from childIds. Linkage now handled inside `createAnnotationFromText`.
- [x] **MADS_ACTIONS updated to new 4-type keys:** Changed from old 6-type keys (correction/restructure/fix/thought) to new 4-type keys (edit/flag).
- [x] **parseSuggestedEdit gated behind edit type only:** Prevents non-edit annotations from being parsed for suggested edits.
- [x] **Regenerate button disabled while resolving:** Prevents double-click race condition.

### QA Coverage -- COMPLETE
- [x] **148 tests written** covering the full Reliability-First UX Overhaul. All passing.
- [x] **Phase 8 tests added** for document migration/collections and change-set grouping.
- [x] **Phase 14 verified:** Total unit tests now 152 passing. Typecheck 0 errors. Build clean.
- [x] **v8.4 verified:** Total unit tests now 287 passing (incl. eval harness + editor mount smoke suite). Typecheck 0 errors. Lint and build clean.

---

## 4. Known Issues & Technical Debt
* **Graphiti Connection Bug:** The Graphiti standard REST API causes SSE 404 errors. *Mitigation:* Ensure the MCP server is booted using `graphiti_mcp_server.py` in the `/mcp_server` directory.
* **Prisma v7 Breaking Changes:** Prisma v7 requires a driver adapter (`@prisma/adapter-libsql` + `@libsql/client`). Generated client exports from `@/generated/prisma/client`. Class is `PrismaLibSql`.
* **Streamdown Runtime Constraint:** `StreamdownTextPrimitive` requires assistant-ui runtime context. Use `Streamdown` from `streamdown` directly for standalone rendering.
* **4 annotation types now active:** `ask | edit | dig | flag`. Legacy 6-type annotations auto-migrate on store rehydration via `migrateAnnotations()`. Legacy CSS classes and Tailwind tokens retained for backward compat.
* **projectStore.ts still present:** Kept only as legacy migration input. It should be deleted after one more stabilization pass confirms no migration regressions.
* **Location grouping is exact-anchor only:** `locationGroupKey` currently uses `documentId:from:to`. No fuzzy anchor re-resolution yet.
* **Document hub still shows duplicate visibility paths:** Documents appear in the global list and inside collections. This is intentional for Phase 8 clarity but may be refined in Phase 9 dashboard work.
* **Visual system not yet fully tokenized:** Phase 13 improved the main app shell and review surfaces, but a full design-token sweep across every modal/overlay is still pending.
* **changesStore persistence has caps:** `partialize` limits entries to 500 and changeSets to 100. If exceeded, oldest are pruned. Emergency pruning clears all entries if localStorage quota is hit.
* **Newer Claude models reject sampling params:** opus-4-7/opus-4-8/fable-5/mythos 400 if `temperature` is sent. Gated by `modelRejectsSampling()` in `modelCapabilities.ts`. Any new API route that calls Claude with sampling params must consult this gate.
* **Cascade anchoring is blockId-first (v8.4):** `proposeCascadeEdits()` anchors via `blockTextRange` on the proposal's `block_id`, falling back to a neighborhood-gated `findTextInDoc` only when the block can't be located. Unanchorable, overlapping, or duplicate-target proposals are dropped (first-proposal-wins). Edits that silently disappear are expected behavior when the document drifted, not a bug.
* **Proposal positions snapshot at resolution start (pre-existing race):** Review-UI highlights can drift if the user edits during resolution; the apply path re-validates and is safe. See v8.4 follow-ups.
* **`hasVerbatimConflict` verifies existence, not relevance:** Evidence quotes are verified verbatim against the live doc, but semantic relevance of the citation is heuristic (changed-token overlap with stopword filter + 2-char number floor).
* **Large docs (>200 textblocks) skip the LLM graph pass:** `LLM_PASS_MAX_BLOCKS = 200` — such docs get deterministic-only edges, so cascade recall there depends on the extractors.
* **Two cascade lanes still exist:** the docGraph editable path (primary) and the Graphiti `cascadeCheck.ts` read-only entity lane (untouched by v8.4, by decision). `DocGraphEdgeSource` reserves `'graphiti'` for a future bridge.
* **parseSuggestedEdit superseded:** Regex `parseSuggestedEdit` is replaced by the `propose_edit` tool on `api/structured`. The regex path remains only for backward compatibility and should be removed in a later pass.

---

## 5. Evolution of Project Decisions (Architecture Log)
* **[2026-03-12] GraphRAG over Vector RAG:** Multi-hop reasoning for cascade checks.
* **[2026-03-12] MADS for anti-sycophancy:** Multi-agent debate to prevent automation bias.
* **[2026-03-12] Event Segmentation UI:** Buffered cascade flags at reading breakpoints.
* **[2026-03-12] EU AI Act Compliance:** Immutable audit logging for Article 12/14.
* **[2026-03-13] All 5 core phases built:** Foundation, Capture, GraphRAG, MADS, Compliance.
* **[2026-03-13] UI Polish + E2E Tests:** Streaming, tooltips, collapsible debate, Playwright tests.
* **[2026-03-15] UX Audit:** User hands-on testing revealed persistence, readability, and action reliability issues. Triggered Reliability-First Overhaul plan.
* **[2026-03-16] Wave 0 — AGENTS.md:** Multi-agent swarm config established for consistent AI collaboration.
* **[2026-03-16] Wave 1 — Flat document model:** Replaced project-folder navigation with `documentStore.ts`. Local-first, no server storage this pass.
* **[2026-03-16] Wave 1 — Import parser rewrite:** Full markdown parsing with lists, blockquotes, tables.
* **[2026-03-16] Wave 1 — Readability fix:** WCAG AA contrast compliance for muted text.
* **[2026-03-16] Wave 1 — All 6 broken buttons fixed:** Each with a specific architectural fix (idempotent apply, deterministic insertion, conversation seeding, inline input, backward-compat rendering, cascade-as-message).
* **[2026-03-16] Wave 2 — 4-intent system:** Consolidated 6 annotation types to 4 (`ask | edit | dig | flag`). Invisible classification replaces upfront intent picker. FloatingIconBar rewritten as single input bar. Clickable badge override on result cards. MADS routing for `edit`, single-agent for `ask`/`dig`, LLM-classified for `flag`.
* **[2026-03-16] Wave 2 — Voice pipeline simplification:** Removed post-recording ActionPicker step. Voice now goes directly: record -> transcribe -> createAnnotationFromText. AI classifies behind the scenes.
* **[2026-03-16] Wave 2 — Prompt consolidation:** fix/correction/restructure prompts merged into single `edit` TYPE_PROMPT. New 4-type CLASSIFICATION_PROMPT.
* **[2026-03-16] Wave 3A — Recursive drilling:** Paragraph-level interactive blocks in AgentMarkdown. DrillMenu with 3 actions. Child annotations linked via parentId/childIds.
* **[2026-03-16] Wave 3B — Verbosity control:** Per-annotation verbosity (concise/normal/detailed) with token limit multipliers and prompt instructions. Regenerate on verbosity change.
* **[2026-03-16] Wave 3C — Annotation sidebar map:** AnnotationMap.tsx minimap with colored dots and type legend. List/map toggle in AnnotationPanel.
* **[2026-03-16] Wave 4A — Gated apply:** SemanticCommitModal gains provocation/isHighRisk props. Conditional friction — only when usedMADS=true AND provocation exists. User must acknowledge concern before Apply enables.
* **[2026-03-16] Wave 4B — Inline provocations:** `extractProvocation()` in mads.ts surfaces strongest Troublemaker challenge on MODIFY/REJECT verdicts. Amber callout on AnnotationCard with "Tell me more" button. provocation/usedMADS fields on Resolution interface.
* **[2026-03-16] Troublemaker bug fixes (6 critical):** Classification wiring, stale closure, phantom child IDs, MADS_ACTIONS keys, parseSuggestedEdit scope, double-click race.
* **[2026-03-16] OVERHAUL COMPLETE:** All 4 waves done. 148 tests passing. Clean typecheck and build.
* **[2026-03-16] PHASE 8 COMPLETE:** Document hub + collections, shared annotation composer, location-first annotation grouping, change-set review layer, and adaptive concise defaults shipped. `npm run typecheck`, `npm test`, and `npm run build` all pass.
* **[2026-03-16] PHASE 13 COMPLETE:** Stronger layout hierarchy, warmer surfaces, clearer badges/chips, and improved panel contrast shipped. `npm run typecheck` and `npm run build` pass after the visual pass.
* **[2026-03-16] PHASE 14 COMPLETE — Bug Fixes and UX Hardening:** Three waves: (A) crash fixes — DocumentHubSidebar collectionIds crash, changesStore quota overflow, drill-action visibility; (B) core interaction fixes — selection-triggered annotations, document modal startup, annotation collapse scope, nested scrolling; (C) enhancements — DiffView in changes panel, formatting toolbar, document hub readability, annotation click-to-scroll. 152 tests passing, typecheck and build clean.
* **[2026-06-29] v8.3 Wave 1 — Model/API refresh:** Newer Claude models reject sampling params and were 400ing every agent call. `modelCapabilities.ts` gates `temperature` omission across `/api/resolve`, `/api/classify`, `/api/generate`. Model list refreshed (Opus 4.8 / Fable 5 / Sonnet 4.6 / Haiku 4.5), default Sonnet 4.6, `normalizeClaudeModel()` migrates stale IDs to Sonnet (never silent Opus upgrade). Compaction pinned to Haiku 4.5.
* **[2026-06-29] v8.3 Wave 2 — Agents/skills:** `.claude/agents/*.md` (8 roles) became the authoritative runtime agent definitions; root `agents.md` demoted to a pointer. New `add-cascade-edit` skill; refreshed build-wave/test skills.
* **[2026-06-29] v8.3 Wave 3 — In-IDE multi-region agent edits:** Read-only cascade upgraded to editable multi-region `ProposedEdit` proposals. New `orchestrator.ts` (`proposeCascadeEdits()`, fingerprint anchoring), `api/structured` `propose_edit` tool replacing regex `parseSuggestedEdit`, `proposedChangePlugin.ts` read-line-aware decorations, and `applyProposedEdits.ts` validate-or-abort descending single-transaction apply (fixes stale-position bug). Audit writes now record `auditFailed` on `.catch()`. 194 tests passing (+42), typecheck and build clean. Project is now a git repo on `main`.
* **[2026-06-29] v8.3 Wave 3 refinements — Reviewable multi-region edits:** Multi-region proposed edits became genuinely reviewable instead of all-or-nothing/bypassing the commit modal. ONE source of truth = the `proposedChangePlugin` per-edit status (`setProposedEditStatus`/`getProposedAnchors`); the commit modal is authoritative at apply time. Three surfaces: inline `ProposedEditControl.tsx` + `proposedEditUiStore.ts` (plugin gained `handleDOMEvents`, decorations skip rejected / grey accepted); multi-diff `SemanticCommitModal` with per-change toggles + `onConfirm(acceptedIds)` (ResolutionActions dropped the direct-apply bypass, applies only the accepted subset); navigable `CascadeList.tsx` in `AnnotationCard` replacing throwaway toasts. `AnnotationCard` owns the decoration review lifecycle. Troublemaker confirmed the two headline risks (source-of-truth divergence, anchor-read-before-clear race) are NOT bugs; review flow now fully satisfies the HITL gate for multi-region edits. 194 tests still passing, typecheck/build clean. Committed + pushed to `Vinylfigure/intent-ide` `main` ("Wave 3 refinements: reviewable multi-region edits").
* **[2026-07-09] v8.4 — Stable block IDs as the anchor of record:** Every string-matched anchor in the system was fragile by construction (repeated phrases anchor to the wrong occurrence). `schema.ts` `withBlockId` + `blockIdPlugin.ts` give every block node a persistent `blockId`; anchoring is now blockId-first everywhere (`blockTextRange`), with string matching demoted to a neighborhood-gated fallback. Deliberate choices: `parseDOM` does not read `data-block-id` (paste mints fresh ids); duplicate-id keeper is the first NON-EMPTY occurrence; stamps ride the triggering history event; initial-load stamping deferred via `queueMicrotask` with `addToHistory: false`.
* **[2026-07-09] v8.4 — Graph-scoped, evidence-gated cascade replaces the whole-doc pass:** New `docGraph.ts` (block-keyed dependency graph: deterministic extractors + one validated `link_blocks` LLM pass ≤200 blocks, FNV-1a contentHash LRU-8 cache with inflight dedupe). `proposeCascadeEdits` now sends only the 2-hop neighborhood (≤24 blocks, text never truncated); the `resolver.ts` `.slice(0, 6000)` truncation is deleted — a 20-page doc now cascades past page 4. Every proposal must cite a verbatim-verified `CascadeEvidence`; severity (`must`/`probably`/`optional`) is DERIVED from graph structure + verbatim-conflict check, never trusted from the model. Precision is the product: an uncited proposal can never be `must`.
* **[2026-07-09] v8.4 — Data-egress boundary for background LLM work:** `scheduleDocGraphRebuild` runs deterministic-only in the background; the LLM `link_blocks` pass runs lazily inside the user-initiated cascade. Decision: document text never leaves the machine as a side effect of typing — background LLM calls from editor loops are a data-egress/cost decision, not a perf optimization.
* **[2026-07-09] v8.4 — EditPropBench-grounded eval harness as regression gate:** 10 fixtures with direct-target/required-downstream/protected-unchanged labels (arXiv:2605.02083 — verified real; the "LEDGER agentic editing" citation is FABRICATED and must never be cited). Gates recall ≥ 0.9, 0 FP violations, 100% citation validity against a scripted model — a pipeline regression gate, not a model benchmark.
* **[2026-07-09] v8.4 — Swarm review caught a ship-blocking mount crash:** typecheck+build+vitest green is NOT evidence the app mounts — plugin `view()` hooks run inside the EditorView constructor and headless tests never construct a view. The blockId plugin's `view()` dispatched during construction → TDZ crash on `const view` in EditorShell `dispatchTransaction`. Fixed with `queueMicrotask` deferral; a jsdom editor-mount smoke suite is now the permanent gate. Also fixed: doc-switch `replaceWith` now `addToHistory: false` (undo could resurrect a previous doc under the new doc's id); blockId-scoped drift recovery in `applyProposedEdits`; invisible control bytes in `contentHash` separators made visible escapes. Shipped as PR #4 (`main` is branch-protected); merged 2026-07-09.
* **[2026-07-09] Cascade v2 Wave A — Relevance judge closes the existence-vs-relevance gap (PR #5, pending merge):** `hasVerbatimConflict` proved a citation EXISTS, not that it MATTERS. New batched LLM judge (`relevanceJudge.ts`) verifies `must`-candidates' citations genuinely conflict, with target block context in the input. Trust boundary decisions: the judge can only LOWER severity (a hallucinating judge cannot escalate); its prompt contains no severity vocabulary (no parroting); judge malfunction — thrown call OR zero valid verdicts — preserves the derived severities, because "the judge failed to answer" must never be read as "the judge denied" (fail-open on demotion, fail-closed on evidence discipline); `maxTokens` scales with candidate count; deny-wins on duplicate verdict indexes. `pickUtilityModel` pins judge + compaction to Haiku 4.5 (claude provider only); graph extraction stays on the user's model because it is a recall mechanism, not housekeeping. `fetchWithRetry` (429/5xx, 2 retries, jittered backoff) hardens the transport. Opt-in live bench (`npm run bench:live`, BENCH_LIVE=1) measures the real pipeline against a live dev server.
* **[2026-07-09] Cascade v2 Wave A — Prompt-caching commit REVERTED after mechanism check (PR #5):** An added prompt-caching "optimization" was proved a cost regression in review: zero shared prefix between cascade and judge calls, the in-process content-hash cache already absorbs identical rebuilds, and the 2000-char trigger sat below Anthropic's 1024/2048-token cacheable minimum — 1.25x write surcharge with zero possible cache hits. Reverted in-branch. Decision: optimization claims require a mechanism check, not vibes.
* **[2026-07-09] Cascade v2 Wave E — Git-model document history with attribution inside the address (PR #6, pending merge):** New `DocCommit` Prisma model (migration `20260709205301_add_doc_commit_history`; unused `DocumentSource` REMOVED, verified against a populated DB). Two-level content addressing like git's tree+commit: `contentHash` = sha256(canonical docJson); commit `hash` additionally covers documentId+parentHash+kind+message+actor+annotationId+auditIds+modelVersion. WHY: adversarial review showed content-only hashing let a racing 'direct' autosave silently absorb an 'apply' commit's AI provenance — commits that agree on WHAT but disagree on WHO/WHY must not collide in an Article 12 ledger. Append-only `/api/history` (POST create-only, server recomputes both hashes, 400 mismatch, 409 stale-head linearity with client rebase-retry-once, idempotent duplicates). Transactional restore ordering: audit event FIRST, commit (embedding the audit id) SECOND, editor dispatch LAST — the UI only mutates after the durable record exists. `changeTrackingPlugin` skips `addToHistory: false` transactions (kills phantom "Direct edit" entries). `docs/compliance.md` honest framing: application-enforced append-only, tamper-EVIDENT not immutable, client-supplied attribution, `auditFailed`→zero-audit-links disclosed. CI now runs `prisma migrate deploy`.
* **[2026-07-09] Process — parallel worktrees + pre-PR adversarial review:** Waves A and E were built simultaneously in git worktrees (`../IDE-wave-a`, `../IDE-wave-e`) off merged PR #4, each through implement → Troublemaker review → fix. Both reviews returned NO-MERGE with HIGH findings (judge malfunction semantics; content-only hash provenance absorption); all were fixed before anything was pushed. This is now the template for Waves B/C/D.
