# Progress Tracker: Intent IDE (v8.2)

## 1. High-Level Status
**Current Phase:** Phase 14 — Bug Fixes and UX Hardening — COMPLETE
**Overall Completion:** Core architecture (5 phases) complete. Reliability-First UX Overhaul complete. Phases 8, 13, and 14 complete. 152 unit tests passing.
**System Status:** Alpha / Core systems built, crash-free, and interaction-complete. Document hub, collections, location-first annotation review, adaptive concise defaults, grouped change-set review, formatting toolbar, selection-triggered annotations, and hardened persistence are now in place. Ready for dashboard/collaboration phases.

---

## 2. Completed Milestones (What Works)

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
