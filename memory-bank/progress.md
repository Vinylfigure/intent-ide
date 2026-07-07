# Progress Tracker: Intent IDE (v8.3)

## 1. High-Level Status
**Current Phase:** Model/API Refresh + In-IDE Multi-Region Agent Edits (Waves 1-3) — COMPLETE
**Overall Completion:** Core architecture (5 phases) complete. Reliability-First UX Overhaul complete. Phases 8, 13, and 14 complete. v8.3 model/API refresh and in-IDE multi-region agent edits complete. 194 unit tests passing.
**System Status:** Alpha / Core systems built, crash-free, and interaction-complete. Git repo on `main`, pushed to private GitHub `Vinylfigure/intent-ide` (3 commits on `origin/main`). Newer Claude models (Opus 4.8 / Fable 5 / Sonnet 4.6 / Haiku 4.5) supported with sampling-param compatibility. Read-only cascade upgraded to editable multi-region `ProposedEdit` proposals backed by provider-agnostic tool-calling, and now genuinely reviewable: inline per-region Accept/Reject, a multi-diff commit modal, and a navigable cascade list all share the `proposedChangePlugin` per-edit status as one source of truth. Authoritative `.claude/agents/*` runtime agent definitions. Ready for dashboard/collaboration phases.

---

## 2. Completed Milestones (What Works)

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
- [x] **Git:** Project is now a git repo on `main`. Two commits: "Initial commit: Intent IDE v8.2 + model/API refresh (Wave 1)" and "Waves 2-3: swarm agents, skills, and in-IDE multi-region agent edits". Private GitHub push complete. (2026-06-29 correction: the `.env` key was verified **never committed** — it is not in git history or the remote; only the local untracked `.env` ever held it. See audit.md.)

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

### v8.3 Wave 3 Refinements — Reviewable Multi-Region Edits -- COMPLETE
All three follow-ups landed against ONE source of truth: the `proposedChangePlugin` per-edit status (`setProposedEditStatus` / `getProposedAnchors`). The plugin holds live per-region status; the commit modal is authoritative at apply time.
- [x] **Inline per-edit Accept/Reject UI:** New `src/components/Editor/ProposedEditControl.tsx` + `src/stores/proposedEditUiStore.ts`. Floating Accept/Reject control on each called-out region. `proposedChangePlugin` gained `handleDOMEvents`; `buildDecorations` now skips rejected regions and greys accepted ones (`proposed-accepted`). Status-only — actual mutation is deferred to the batched apply.
- [x] **Multi-diff SemanticCommitModal:** `src/components/Editor/SemanticCommitModal.tsx` now renders per-change Accept/Reject toggles when there is >1 change, exposes `onConfirm(acceptedIds: string[])`, and seeds `initialRejected` from the live plugin status. `src/components/Annotations/ResolutionActions.tsx` routes the multi-edit case through the modal (the old direct-apply bypass is removed) and applies only the accepted subset via `applyProposedEdits(view, acceptedIds)`.
- [x] **Navigable cascade review list:** New `src/components/Annotations/CascadeList.tsx` ("affects N sections", click-to-scroll, per-row Accept/Reject), rendered in `AnnotationCard.tsx`, replacing the throwaway cascade toasts.
- [x] **Decoration review lifecycle in `AnnotationCard.tsx`:** `useEffect` shows proposed-edit decorations while the card is active + `status==='resolved'` + `edits.length>1`, and clears them on apply / dismiss / deactivate.
- [x] **Troublemaker review (pre-commit):** CascadeList gated on `status==='resolved'` (fixes stale "Pending" after apply); multi-region change-entry records the consistent old range (`ap.to`); inline control switches decorations in one click (outside-click ignores `[data-proposed-edit-id]`); defensive empty-`acceptedIds` guard. Troublemaker confirmed the two headline risks (source-of-truth divergence, anchor-read-before-clear race) are NOT bugs.
- [x] **Verification:** `npm run typecheck` 0 errors, `npm run test` 194 passing, `npm run build` clean. Committed and pushed to private GitHub `Vinylfigure/intent-ide` `main` ("Wave 3 refinements: reviewable multi-region edits") — 3 commits on `origin/main`.

### v8.3 Follow-ups (Pending)
- [x] **`.env` key — verified NOT a leak (2026-06-29):** Earlier notes claimed a key reached git history before `.gitignore` covered it. Direct verification (`.gitignore` predates `git init`; `git ls-files --error-unmatch .env` → never tracked; key-prefix search across all commits → 0 hits) confirmed the key was **never committed** and is not in the remote. Only the local untracked `.env` held it. There is no history to scrub; rotating it is optional routine hygiene, not leak remediation.
- [ ] **Modal -> plugin write-back symmetry (optional polish):** The commit modal is authoritative at apply, but accept/reject toggles inside the modal do not write back to the plugin status. Mirroring them would keep all three surfaces live-synced even before apply.
- [ ] **Local Whisper for fully-offline voice (optional):** Replace the hosted Whisper transcription with a local model for an end-to-end offline path.


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
* **`.env` key — verified NOT in git history (corrected 2026-06-29):** An earlier entry claimed a key was committed in `.env` before `.gitignore` covered it and existed in remote history. This was verified **false**: `.gitignore` predates `git init`, `.env` was never tracked, and a key-prefix search across all commits returns 0 hits. The live key existed only in the local untracked `.env`. No history scrub is needed; optional hygiene rotation only. See audit.md 2026-06-29 correction.
* **Cascade anchoring is fingerprint-based:** `proposeCascadeEdits()` drops proposals whose target text cannot be re-anchored to live positions, or that overlap. Edits that silently disappear are expected behavior when the document drifted, not a bug.
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
* **[2026-06-29] v8.3 Wave 3 — In-IDE multi-region agent edits:** Read-only cascade upgraded to editable multi-region `ProposedEdit` proposals. New `orchestrator.ts` (`proposeCascadeEdits()`, fingerprint anchoring), `api/structured` `propose_edit` tool replacing regex `parseSuggestedEdit`, `proposedChangePlugin.ts` read-line-aware decorations, and `applyProposedEdits.ts` validate-or-abort descending single-transaction apply (fixes stale-position bug). Audit writes now record `auditFailed` on `.catch()`. 194 tests passing (+42), typecheck and build clean. Project is now a git repo on `main`; private push pending key rotation.
* **[2026-06-29] v8.3 Wave 3 refinements — Reviewable multi-region edits:** Multi-region proposed edits became genuinely reviewable instead of all-or-nothing/bypassing the commit modal. ONE source of truth = the `proposedChangePlugin` per-edit status (`setProposedEditStatus`/`getProposedAnchors`); the commit modal is authoritative at apply time. Three surfaces: inline `ProposedEditControl.tsx` + `proposedEditUiStore.ts` (plugin gained `handleDOMEvents`, decorations skip rejected / grey accepted); multi-diff `SemanticCommitModal` with per-change toggles + `onConfirm(acceptedIds)` (ResolutionActions dropped the direct-apply bypass, applies only the accepted subset); navigable `CascadeList.tsx` in `AnnotationCard` replacing throwaway toasts. `AnnotationCard` owns the decoration review lifecycle. Troublemaker confirmed the two headline risks (source-of-truth divergence, anchor-read-before-clear race) are NOT bugs; review flow now fully satisfies the HITL gate for multi-region edits. 194 tests still passing, typecheck/build clean. Committed + pushed to private `Vinylfigure/intent-ide` `main` ("Wave 3 refinements: reviewable multi-region edits"), 3 commits on `origin/main`. (`.env` key later verified never committed — 2026-06-29 correction; optional hygiene rotation only.)
