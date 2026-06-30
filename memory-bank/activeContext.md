# Active Context: Intent IDE (v8.2)

## 1. Current Work Focus
**Phase 14 — Bug Fixes and UX Hardening — COMPLETE**
Phase 14 addressed crashes, core interaction gaps, and usability rough edges across three waves. DocumentHubSidebar crash fixed, changesStore persistence hardened, drill-action visibility corrected, selection-triggered annotations added, document modal startup fixed, annotation expand/collapse restricted to header, nested scrolling eliminated, changes panel improved with DiffView, formatting toolbar added, document hub readability boosted, and annotation click-to-scroll refined.

## 2. Immediate Next Steps (The "To-Do" List)
**Phase 14 is complete. The product is now crash-free, interaction-complete, and visually polished.**

Recommended next directions:
1. **Phase 9 — Review dashboard:** Document/collection summaries, pending review counts, unresolved flags, recent change-set activity.
2. **Phase 10 — Collaboration metadata:** `createdBy`, `modifiedBy`, reviewer identity, local placeholder authorship.
3. **Phase 11 — Auth and shared persistence:** Backend persistence, login, shared workspaces, multi-user review state.
4. **Phase 15 — Analytics and optimization:** Workflow telemetry, latency measurement, response-quality tuning.
5. **Phase 12 — Advanced audit and policy ops:** Policy-linked review queues, exports, and compliance summaries.

## 3. Active Decisions & Technical Constraints
* **No innerHTML:** Using `dangerouslySetInnerHTML` is strictly forbidden. All AI output routes through `Streamdown`.
* **Document persistence is local-first:** `documentStore.ts` saves content to localStorage under `intent-ide-doc:{id}` keys. Collections and migrated legacy project docs are stored in the same flat metadata store. Legacy docs with missing `collectionIds` are normalized on rehydration.
* **Flat document model with collections:** `documentStore.ts` is now the only active document source of truth. `projectStore.ts` remains solely as legacy migration input.
* **Auto-save:** 5-second debounce on ProseMirror `docChanged` transactions. `beforeunload` warning when dirty.
* **4-intent annotation system:** `ask | edit | dig | flag` (consolidated from the original 6 types). Legacy types auto-migrate on store rehydration via `migrateAnnotations()`. Colors: ask=blue, edit=red, dig=purple, flag=amber.
* **Shared annotation composer:** Selection capture, thread drilling, and spin-off annotation flows now use the same input/chips/mic composer. Quick chips bias classification but do not bypass it.
* **Invisible classification with hints:** Users type or speak naturally; AI classifies into the 4 types. Composer quick chips pass a hint and fallback type into classification.
* **Selection-triggered annotation entry:** FloatingIconBar now appears on text selection (mouseup and keyboard selection) in addition to right-click, via `contextMenuPlugin.ts`.
* **MADS routing:** `edit` type routes through MADS (Troublemaker/Peacemaker/Judge debate). `ask`/`dig` use single-agent. `flag` uses LLM-classified complexity.
* **MADS provocations:** `extractProvocation()` in `mads.ts` pulls the strongest Troublemaker challenge from MODIFY/REJECT verdicts. Provocations surface as inline amber callouts on AnnotationCard and as gated apply friction in SemanticCommitModal.
* **Gated apply for high-risk edits:** When `usedMADS=true` and a provocation exists, SemanticCommitModal requires explicit user acknowledgment ("I've considered this -- proceed") before the Apply button enables.
* **HITL Default:** Every AI-generated output defaults to `PENDING_REVIEW`. Never auto-apply global document changes.
* **Multi-agent swarm:** `AGENTS.md` defines 10 roles with tool mappings and workflow protocol for all AI assistants in this repo.
* **Location-first annotation review:** Annotations now carry `documentId` and `locationGroupKey`; the annotation panel groups by anchor location for the active document and nests thread descendants underneath.
* **Adaptive concise default:** New annotations default to concise except `section + dig`, which defaults to normal. Regenerate only appears after a user deviates from the adaptive default.
* **Change-set review layer:** `changesStore.ts` now tracks grouped `ChangeSet`s keyed by root annotation thread. Changes panel is the primary grouped review surface; audit tab is raw evidence. Store persistence is hardened with quota handling and emergency pruning.
* **Vitest boundary fixed:** `vitest.config.ts` now scopes unit tests to repo `src/**/*.test.*` files and excludes Playwright / dependency suites.
* **Visual system hardening:** `globals.css` now defines stronger app-shell/editor-stage/panel surface styles; layout components use warmer layered backgrounds, clearer chips, and higher-contrast cards.
* **Formatting toolbar:** `FormattingToolbar.tsx` provides Bold/Italic/Code/H1-H3/Lists/Blockquote with Mod-b/Mod-i/Mod-` keybindings in the editor.
* **Annotation expand/collapse:** Only the header row is clickable for expand/collapse, not the full card body.
* **Document startup:** When documents exist, the most recent is auto-selected instead of showing the new-document modal.

## 4. Recent Events (Sliding Window)
* **[2026-03-16] Phase 14 complete — Wave A (Crash Fixes):** Fixed DocumentHubSidebar crash (defensive `collectionIds ?? []` + migration), hardened changesStore persistence (partialize caps, quota error handling, emergency pruning), fixed drill-action visibility (suggestedIntent fallback, toast, scroll-to-annotation event).
* **[2026-03-16] Phase 14 complete — Wave B (Core Interaction Fixes):** Selection-triggered annotation entry via mouseup/keyboard handlers in contextMenuPlugin.ts, auto-select most recent doc on startup, annotation expand/collapse restricted to header only, nested right-panel scrolling eliminated.
* **[2026-03-16] Phase 14 complete — Wave C (Enhancements):** ChangeEntry now uses DiffView with line numbers and per-entry expand/collapse, FormattingToolbar.tsx with keybindings, document hub readability improved (text-xs text-ink/50-60), annotation click-to-scroll with TextSelection fallback and clickable quoted excerpt anchor preview.
* **[2026-03-16] Verification:** `npm run typecheck` (0 errors), 152 tests passing, `npm run build` (clean).
* **[2026-03-16] Phase 13 complete:** App shell, document hub, annotations, changes, status bar, and audit detail received stronger visual hierarchy and contrast improvements.
* **[2026-03-16] Phase 8 complete:** Flat document hub, collections, one-time migration from legacy projects, and explicit active-document switching landed.

---
**Agent Directive:** Phase 14 is complete. The product is crash-free and interaction-complete. Future work should build Phase 9+ on the stable foundation: document hub, location-first review, change-set layer, formatting toolbar, and selection-triggered annotations. Do not reintroduce nested project state or flat event review.
