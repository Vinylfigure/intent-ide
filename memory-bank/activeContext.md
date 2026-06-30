# Active Context: Intent IDE (v8.3)

## 1. Current Work Focus
**Model/API Refresh + In-IDE Multi-Region Agent Edits (Waves 1-3) — COMPLETE**
A three-wave refresh landed on the new `main` branch. Wave 1 fixed the real cause of agent-call failures on newer Claude models: those models 400 on sampling params, so the Claude branch of `/api/resolve`, `/api/classify`, and `/api/generate` now omits `temperature` for them (gated by `modelCapabilities.ts`). The model list, default, and stale-ID migration were refreshed in `settingsStore.ts`. Wave 2 promoted `.claude/agents/*.md` (8 roles) to the authoritative runtime agent definitions and added the `add-cascade-edit` skill. Wave 3 upgraded the read-only cascade into editable multi-region `ProposedEdit` proposals — `orchestrator.ts` anchors them by fingerprint, `api/structured` serves a provider-agnostic `propose_edit` tool, `proposedChangePlugin.ts` renders read-line-aware "called out" decorations, and `applyProposedEdits.ts` does a validate-or-abort descending single-transaction apply (fixing a latent stale-position bug). Audit writes now record `auditFailed` instead of dropping silently.

## 2. Immediate Next Steps (The "To-Do" List)
**Waves 1-3 are complete and committed on `main`. Typecheck clean, 194 tests passing, build clean.**

Immediate:
1. **Push to private GitHub** — BLOCKED on the user rotating a key that was committed in `.env`. Do not push until the secret is rotated and history is clean.

Optional Wave 3 refinements:
2. **Inline per-edit Accept/Reject UI** on the called-out decorations.
3. **Multi-diff SemanticCommitModal** — review multiple `ProposedEdit` regions in one modal.
4. **Navigable cascade review list** — step through cascade proposals region-by-region.

Longer-horizon phases (unchanged):
5. **Phase 9 — Review dashboard:** Document/collection summaries, pending review counts, unresolved flags, recent change-set activity.
6. **Phase 10 — Collaboration metadata:** `createdBy`, `modifiedBy`, reviewer identity, local placeholder authorship.
7. **Phase 11 — Auth and shared persistence:** Backend persistence, login, shared workspaces, multi-user review state.

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
* **Sampling-param gate:** Newer Claude models (opus-4-7/opus-4-8/fable-5/mythos) 400 on `temperature`. `modelRejectsSampling()` in `modelCapabilities.ts` is the single source of truth — every Claude API route must consult it before sending sampling params.
* **Safe model migration:** `normalizeClaudeModel()` migrates stale localStorage model IDs to Sonnet 4.6, never silent-upgrading to Opus. Default model stays Sonnet 4.6; compaction is pinned to Haiku 4.5 regardless of selection.
* **Authoritative agents in `.claude/agents/`:** The 8 `.claude/agents/*.md` files are now the runtime agent definitions. Root `agents.md` is a summary that points at them, not a source of truth.
* **Editable multi-region cascade:** The cascade is no longer read-only. `proposeCascadeEdits()` in `orchestrator.ts` produces `ProposedEdit[]` anchored to live positions by fingerprint match; unanchorable or overlapping proposals are dropped. `resolver.ts` populates `Resolution.edits` on both MADS and single-agent paths.
* **Structured tool-calling over regex:** `api/structured` serves a provider-agnostic `propose_edit` tool, replacing the brittle regex `parseSuggestedEdit`.
* **Read-line-aware decorations:** `proposedChangePlugin.ts` flags proposed changes above the read-line ("you already read this changed") and shows them quietly below; positions are re-mapped through `tr.mapping`.
* **Validate-or-abort apply:** `applyProposedEdits.ts` fingerprint-validates then applies edits in a single descending transaction. This fixed a latent bug where apply read stale Zustand anchor positions.
* **Audit durability:** `logResolutionAudit` call sites `.catch()` and set `resolution.auditFailed` so EU AI Act records are never dropped silently.

## 4. Recent Events (Sliding Window)
* **[2026-06-29] v8.3 Wave 1 — Model/API refresh:** `modelCapabilities.ts` added; `/api/resolve`, `/api/classify`, `/api/generate` omit `temperature` for sampling-rejecting models (the real cause of newer-model agent failures). `settingsStore.ts` model list refreshed (Opus 4.8 / Fable 5 / Sonnet 4.6 / Haiku 4.5 + legacy Opus 4.6), default Sonnet 4.6, `normalizeClaudeModel()` migration on rehydrate. ApiKeyModal cost/diversity notices; compaction pinned to Haiku 4.5.
* **[2026-06-29] v8.3 Wave 2 — Agents/skills:** `.claude/agents/*.md` (8 roles) promoted to authoritative runtime definitions; root `agents.md` demoted to summary. New `add-cascade-edit` skill; refreshed build-wave/test skills.
* **[2026-06-29] v8.3 Wave 3 — In-IDE multi-region agent edits:** `ProposedEdit` type + `Resolution.edits`/`auditFailed`; new `orchestrator.ts`, `api/structured` (`propose_edit` tool), `proposedChangePlugin.ts`, `applyProposedEdits.ts`. Read-only cascade is now editable multi-region. Audit `.catch()` durability.
* **[2026-06-29] Verification + git:** `npm run typecheck` 0 errors, `npm run test` 194 passing (+42 for modelCapabilities + settings migration), `npm run build` clean. Project initialized as a git repo on `main` (2 commits). Private GitHub push pending key rotation.
* **[2026-03-16] Phase 14 complete — Wave A (Crash Fixes):** Fixed DocumentHubSidebar crash (defensive `collectionIds ?? []` + migration), hardened changesStore persistence (partialize caps, quota error handling, emergency pruning), fixed drill-action visibility (suggestedIntent fallback, toast, scroll-to-annotation event).
* **[2026-03-16] Phase 14 complete — Wave B (Core Interaction Fixes):** Selection-triggered annotation entry via mouseup/keyboard handlers in contextMenuPlugin.ts, auto-select most recent doc on startup, annotation expand/collapse restricted to header only, nested right-panel scrolling eliminated.
* **[2026-03-16] Phase 14 complete — Wave C (Enhancements):** ChangeEntry now uses DiffView with line numbers and per-entry expand/collapse, FormattingToolbar.tsx with keybindings, document hub readability improved (text-xs text-ink/50-60), annotation click-to-scroll with TextSelection fallback and clickable quoted excerpt anchor preview.
* **[2026-03-16] Verification:** `npm run typecheck` (0 errors), 152 tests passing, `npm run build` (clean).
* **[2026-03-16] Phase 13 complete:** App shell, document hub, annotations, changes, status bar, and audit detail received stronger visual hierarchy and contrast improvements.

---
**Agent Directive:** v8.3 Waves 1-3 are complete and committed on `main`. The newer-model agent-call failures are resolved (sampling-param gate), and the cascade is now editable multi-region. The single blocking next step is the private GitHub push, which must wait for the user to rotate the key committed in `.env` — do not push before then. Optional Wave 3 refinements (inline per-edit Accept/Reject, multi-diff modal, navigable cascade list) build on `orchestrator.ts` + `proposedChangePlugin.ts` + `applyProposedEdits.ts`. When adding any Claude API route, consult `modelRejectsSampling()` before sending sampling params. Do not reintroduce nested project state, flat event review, or the regex `parseSuggestedEdit` path.
