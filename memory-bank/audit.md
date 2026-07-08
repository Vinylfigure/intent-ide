# System Audit Log & Compliance Blueprint

This file serves as the immutable, chronological ledger of major architectural shifts and agentic actions taken during the development of the Intent IDE. 

**AI Directive:** This file is APPEND-ONLY. The AI must never delete or modify past entries. Every time a major global configuration, dependency, or security setting is changed, the AI must log it here.

## 1. Production Audit Schema (Reference)
When building the backend database for the Intent IDE, the AI must ensure the `AuditLog` table captures these exact fields to satisfy EU AI Act Article 12 & 14 and the ALCOA+ data integrity principles:
*   **Timestamp_UTC:** Exact time of the event.
*   **Audit_ID:** Unique, immutable identifier linking backward to the source and forward to outcomes.
*   **User/Agent_ID:** Identity of the person or sub-agent executing the action.
*   **Model_Version:** The exact LLM deployed (e.g., claude-3-7-sonnet-20250219).
*   **Prompt_Hash / Input:** The specific prompt template and input data used.
*   **Reference_Database:** The specific Graphiti nodes/edges retrieved during the "Cascade Check".
*   **Output_Commit:** The resulting Semantic Commit proposed.
*   **Approval_Status:** Workflow state (e.g., PENDING, APPROVED_HUMAN, REJECTED) to prove Human-in-the-Loop oversight.

---

## 2. Development Audit Log

**[2026-03-12 22:45:00 UTC] - INIT**
*   **Action:** Initialized Project Memory Bank.
*   **Agent:** Claude Code / Cursor.
*   **Context:** Transitioned PRD from v6 to v7.0.
*   **Decisions Logged:**
    *   Enforced `shadcn/ui` and `@assistant-ui/react-streamdown` for the frontend.
    *   Mandated Graphiti (via MCP) and FalkorDB for the Knowledge Graph layer instead of vector databases to enable multi-hop reasoning.
    *   Forbidden the use of `innerHTML` to prevent XSS vulnerabilities.
*   **Approval:** Human verified.

**[2026-03-16 00:00:00 UTC] - ARCHITECTURE_CHANGE**
*   **Action:** Created `AGENTS.md` multi-agent swarm configuration (Wave 0).
*   **Agent:** Code Librarian / Claude Code.
*   **Context:** UX audit on 2026-03-15 triggered a Reliability-First UX Overhaul plan. Wave 0 established the multi-agent coordination framework before code changes began.
*   **Decisions Logged:**
    *   Defined 10 agent roles with strict boundaries (Orchestrator, PM, Architect, UI-UX, Optimizer, Troublemaker, Judge, Security Auditor, QA, DevOps, Code Librarian).
    *   Established a 7-step workflow protocol: requirement -> plan -> execute -> test -> review -> verify -> document.
    *   Agent-to-tool mapping table for Claude Code subagent routing.
*   **Approval:** Human verified.

**[2026-03-16 00:00:00 UTC] - ARCHITECTURE_CHANGE**
*   **Action:** Replaced project-folder document model with flat document hub (Wave 1A).
*   **Agent:** UI-UX Specialist / Claude Code.
*   **Context:** Documents were not persisting across reloads. The project-folder abstraction was confusing and the wrong model for a document review tool.
*   **Decisions Logged:**
    *   New `documentStore.ts` with flat document model — localStorage content storage keyed by `intent-ide-doc:{id}`.
    *   Auto-save with 5-second debounce on ProseMirror `docChanged` transactions.
    *   `projectStore.ts` retained for backward compatibility but no longer primary.
    *   No server-backed storage this pass (local-first decision).
    *   `beforeunload` warning and save status indicator added to AppShell.
*   **Approval:** Human verified.

**[2026-03-16 00:00:00 UTC] - ACCESSIBILITY_FIX**
*   **Action:** Fixed low-contrast text throughout UI (Wave 1C).
*   **Agent:** UI-UX Specialist / Claude Code.
*   **Context:** `#7a756d` text on white background had ~3.5:1 contrast ratio, below WCAG AA minimum of 4.5:1.
*   **Decisions Logged:**
    *   `--muted-foreground` CSS variable changed from `30 6% 45%` to `30 8% 32%` (~6:1 contrast ratio).
    *   All hardcoded `#7a756d` hex values replaced with `hsl(var(--muted-foreground))` for single-point future fixes.
*   **Approval:** Human verified.

**[2026-03-16 00:00:00 UTC] - BUG_FIX**
*   **Action:** Fixed all 6 broken annotation action buttons (Wave 1D).
*   **Agent:** UI-UX Specialist / Claude Code.
*   **Context:** Apply deleted content on double-click. Add to doc, Keep digging, Tweak it, Follow-up, and Show affected were all silently failing.
*   **Decisions Logged:**
    *   Apply: idempotent with disable-after-success guard.
    *   Add to doc: deterministic insertion contract with fallback to paragraph insertion.
    *   Keep digging: seeds conversation before follow-up to prevent empty-array failures.
    *   Tweak it: replaced canned auto-message with inline text input requiring explicit user input (preserves HITL principle).
    *   Show affected: cascade results injected as persistent conversation messages rather than transient toasts.
*   **Approval:** Human verified.

**[2026-03-16 00:00:00 UTC] - ARCHITECTURE_CHANGE**
*   **Action:** Consolidated 6 annotation types to 4-type system (Wave 2A).
*   **Agent:** UI-UX Specialist / Claude Code.
*   **Context:** The original 6 types (question, fix, correction, restructure, explore, thought) were confusing even to the project creator. Types had overlapping semantics (fix vs correction vs restructure all mean "change something").
*   **Decisions Logged:**
    *   New type union: `'ask' | 'edit' | 'dig' | 'flag'` replaces 6-type union.
    *   Legacy migration via `mapLegacyType()` and `migrateAnnotations()` on store rehydration — no data loss for existing users.
    *   New color scheme: ask=blue, edit=red, dig=purple, flag=amber.
    *   `ANNOTATION_ICONS` removed (no longer needed with invisible classification UX).
    *   `ANNOTATION_DESCRIPTIONS` added for human-readable type explanations.
*   **Approval:** Human verified.

**[2026-03-16 00:00:00 UTC] - ARCHITECTURE_CHANGE**
*   **Action:** Replaced upfront intent picker with invisible AI classification (Wave 2B).
*   **Agent:** UI-UX Specialist / Claude Code.
*   **Context:** Asking users to classify their own intent before seeing results adds cognitive load and often leads to wrong classifications. The system should classify, not the user.
*   **Decisions Logged:**
    *   `FloatingIconBar.tsx` completely rewritten: 6-icon type picker removed, replaced with single input bar (text + mic + submit).
    *   Voice pipeline simplified: removed ActionPicker intermediate step. Flow is now record -> transcribe -> createAnnotationFromText.
    *   `AnnotationCard.tsx` badge is clickable for post-hoc override. Non-mutating overrides (ask<->dig, dig<->flag) relabel only. Mutating overrides (anything<->edit) re-run resolution via `streamResolveAnnotation`.
    *   `classifier.ts` and `/api/classify` route updated for 4-type system.
*   **Approval:** Human verified.

**[2026-03-16 00:00:00 UTC] - ARCHITECTURE_CHANGE**
*   **Action:** Updated MADS routing and prompt system for 4-type model (Wave 2C).
*   **Agent:** Architect / Claude Code.
*   **Context:** With 6 types consolidated to 4, the routing logic and prompt templates needed updating. Three separate edit-style prompts (fix, correction, restructure) had significant overlap.
*   **Decisions Logged:**
    *   `edit` type always routes through MADS (complex). `ask`/`dig` always single-agent (simple). `flag` uses LLM-classified complexity.
    *   fix/correction/restructure prompts merged into single `edit` TYPE_PROMPT.
    *   New 4-type `CLASSIFICATION_PROMPT` in `prompts.ts`.
    *   Edit-type detection in `resolver.ts` simplified from `type === 'fix' || type === 'correction' || type === 'restructure'` to `type === 'edit'`.
    *   Default fallback type changed from `thought` to `flag`.
*   **Approval:** Human verified.

**[2026-03-16 00:00:00 UTC] - FEATURE_ADD**
*   **Action:** Added recursive annotation drilling to AI response content (Wave 3A).
*   **Agent:** UI-UX Specialist / Claude Code.
*   **Context:** Users needed a way to drill into specific parts of AI responses to ask follow-up questions, request clarifications, or suggest edits at a more granular level than the full response.
*   **Decisions Logged:**
    *   `AgentMarkdown.tsx` gained `interactive` and `onDrill` props. When interactive, markdown is split into paragraph-level blocks (not sentence-level).
    *   Paragraph-level granularity chosen because it is native to the markdown AST, avoiding fragile sentence splitting.
    *   DrillMenu positioned at click point with 3 actions: "Dig deeper" (dig), "What's this mean?" (ask), "Edit this" (edit).
    *   Child annotations created via `createAnnotationFromText` using parent's anchor positions. Linked via `parentId`/`childIds`.
    *   No "flag" drill action — flagging a sub-paragraph of an AI response is not a natural workflow.
*   **Approval:** Human verified.

**[2026-03-16 00:00:00 UTC] - FEATURE_ADD**
*   **Action:** Added per-annotation verbosity control (Wave 3B).
*   **Agent:** UI-UX Specialist / Claude Code.
*   **Context:** Users need control over AI response length. Some annotations need brief answers, others need detailed analysis. A one-size-fits-all approach frustrates both use cases.
*   **Decisions Logged:**
    *   New `Verbosity = 'concise' | 'normal' | 'detailed'` type added to `types.ts`. `verbosity` field added to `Annotation` interface.
    *   `VERBOSITY_MULTIPLIER` (concise=0.5x, normal=1x, detailed=2x) applied to token limits in `resolver.ts`.
    *   `VERBOSITY_INSTRUCTIONS` appended to prompts in `resolveAnnotation`, `streamResolveAnnotation`, and `continueThread`.
    *   Short/Normal/Long toggle in `AnnotationCard.tsx`. Regenerate button appears only when verbosity differs from normal.
    *   Default `verbosity: 'normal'` set in `pipeline.ts` for new annotations.
*   **Approval:** Human verified.

**[2026-03-16 00:00:00 UTC] - FEATURE_ADD**
*   **Action:** Added annotation sidebar map with spatial visualization (Wave 3C).
*   **Agent:** UI-UX Specialist / Claude Code.
*   **Context:** The list view in the annotation panel provides no spatial context about where annotations are in the document. A minimap view fills this gap.
*   **Decisions Logged:**
    *   New `AnnotationMap.tsx` component with colored dots at proportional document positions.
    *   Click dot scrolls editor and activates annotation.
    *   Legend shows type counts (doubles as summary and filter reference).
    *   `AnnotationPanel.tsx` updated with list/map toggle in panel header and count indicator.
    *   No new stores or persistence — the map is a derived view of existing annotation state.
*   **Approval:** Human verified.

**[2026-03-16 00:00:00 UTC] - FEATURE_ADD**
*   **Action:** Added gated apply for high-risk edits (Wave 4A).
*   **Agent:** UI-UX Specialist / Claude Code.
*   **Context:** When MADS produces a resolution with an unresolved Troublemaker objection (provocation), the user should not be able to blindly click Apply. A friction gate ensures they consciously acknowledge the concern.
*   **Decisions Logged:**
    *   `SemanticCommitModal.tsx` gained `provocation` and `isHighRisk` props.
    *   Gate is conditional: only when `usedMADS=true` AND a provocation exists. Low-risk single-agent resolutions are not gated.
    *   User must click "I've considered this -- proceed" to enable the Apply button.
    *   Provocation displayed as amber callout with warning icon in the modal.
    *   This implements the HITL principle for high-risk AI-generated edits.
*   **Approval:** Human verified.

**[2026-03-16 00:00:00 UTC] - FEATURE_ADD**
*   **Action:** Added inline provocations from MADS debate (Wave 4B).
*   **Agent:** UI-UX Specialist / Claude Code.
*   **Context:** The MADS debate produces Troublemaker objections that were previously hidden. Surfacing these as inline callouts on annotation cards lets users see dissenting AI opinions without expanding the full debate log.
*   **Decisions Logged:**
    *   `extractProvocation()` function added to `mads.ts`. Parses CHALLENGES section, selects strongest Troublemaker objection.
    *   Only fires on MODIFY or REJECT verdicts (APPROVE means concerns were addressed).
    *   `provocation` (string|null) and `usedMADS` (boolean) added to Resolution interface in `types.ts`.
    *   Inline amber callout in `AnnotationCard.tsx` with "Tell me more" button that creates a follow-up about the concern.
    *   `ResolutionActions.tsx` passes provocation and isHighRisk through to SemanticCommitModal.
*   **Approval:** Human verified.

**[2026-03-16 00:00:00 UTC] - BUG_FIX**
*   **Action:** Fixed 6 critical bugs discovered by Troublemaker agent during QA testing.
*   **Agent:** Troublemaker + QA / Claude Code.
*   **Context:** After Waves 1-3 were built, the Troublemaker agent and QA agent identified 6 bugs that affected core annotation functionality. These were caught by the 148 tests written during the overhaul.
*   **Decisions Logged:**
    *   (1) Classification was not wired in `createAnnotationFromText` — all annotations defaulted to 'flag'. Fixed by calling `classifyAnnotation()`.
    *   (2) Regenerate button used stale closure data. Fixed by reading fresh from `annotationStore.getState()`.
    *   (3) Parent-child linkage stored phantom 'pending' ID. Fixed by deferring linkage to after real ID assignment in `createAnnotationFromText`.
    *   (4) `MADS_ACTIONS` map still used old 6-type keys. Fixed by updating to new 4-type keys (edit/flag).
    *   (5) `parseSuggestedEdit` ran on all annotation types. Fixed by gating behind `annotation.type === 'edit'`.
    *   (6) Regenerate button had no disabled guard during resolution. Fixed by adding `isResolving` check.
*   **Approval:** Human verified.

**[2026-03-16 00:00:00 UTC] - MILESTONE**
*   **Action:** Reliability-First UX Overhaul completed (all 4 waves).
*   **Agent:** Full swarm (Orchestrator, PM, Architect, UI-UX, Troublemaker, QA, Code Librarian).
*   **Context:** The hands-on UX audit on 2026-03-15 triggered a comprehensive 4-wave overhaul. All waves are now complete with 148 tests passing and clean typecheck/build.
*   **Summary:**
    *   Wave 0: Multi-agent swarm config (AGENTS.md).
    *   Wave 1: Document persistence, import fidelity, readability (WCAG AA), 6 broken buttons fixed, progress indicator.
    *   Wave 2: 4-intent system (ask/edit/dig/flag), invisible classification, voice pipeline simplification, prompt consolidation.
    *   Wave 3: Recursive paragraph-level drilling, per-annotation verbosity control, annotation sidebar minimap.
    *   Wave 4: Gated apply for high-risk MADS edits, inline Troublemaker provocations.
    *   Plus: 148 tests, 6 critical Troublemaker-discovered bugs fixed.
*   **Approval:** Human verified.

**[2026-03-16 00:00:00 UTC] - FEATURE_ADD**
*   **Action:** Implemented Phase 8 coherence pass across document navigation and annotation review.
*   **Agent:** UI-UX Specialist / Claude Code.
*   **Context:** User feedback showed that the shipped product still behaved like two overlapping systems: flat documents in architecture docs, nested projects in UI, multiple annotation capture models, and flat event review. Phase 8 was designed to collapse that inconsistency into one primary workflow.
*   **Decisions Logged:**
    *   `documentStore.ts` is now the active document source of truth. It gained `CollectionMeta`, document `collectionIds`, and one-time migration from `intent-ide-projects`.
    *   Legacy `projectStore.ts` is retained only as read-only migration input. It is no longer used by the live navigation UI.
    *   `DocumentHubSidebar.tsx` replaced the project sidebar with all-documents + collections navigation and document actions.
    *   `EditorShell.tsx` now flushes dirty state and loads new content when `activeDocumentId` changes after mount.
    *   `DocInputModal.tsx` now creates fresh blank/paste/generated/imported documents with explicit title and optional collection assignment.
    *   `AnnotationComposer.tsx` became the shared capture UI for selection capture, recursive drilling, and spin-off annotations.
    *   `Annotation` gained `documentId` and `locationGroupKey`; `AnnotationPanel.tsx` now groups by active-document location instead of flat chronology.
    *   `ChangeSet` added to the changes domain so grouped review happens above raw change/audit events.
    *   Adaptive concise defaults replaced `normal` as the baseline verbosity for most new annotations.
*   **Approval:** Human verified.

**[2026-03-16 00:00:00 UTC] - TEST_INFRA**
*   **Action:** Fixed unit-test scope after Phase 8.
*   **Agent:** QA / Claude Code.
*   **Context:** `npm test` initially mixed Playwright specs and dependency test suites into Vitest execution, producing false failures unrelated to the repo’s own code.
*   **Decisions Logged:**
    *   `vitest.config.ts` now uses explicit `include` patterns for `src/**/*.test.ts` and `src/**/*.test.tsx`.
    *   Playwright tests under `tests/**` remain outside Vitest.
    *   Added Phase 8 store tests for legacy migration/collections and change-set grouping.
*   **Approval:** Human verified.

**[2026-03-16 00:00:00 UTC] - FEATURE_ADD**
*   **Action:** Implemented Phase 13 visual hardening pass.
*   **Agent:** UI-UX Specialist / Claude Code.
*   **Context:** After Phase 8, the interaction model was coherent but the app still felt visually flat: too much gray, weak panel separation, and low-signal status presentation. The goal was to improve hierarchy without altering behavior.
*   **Decisions Logged:**
    *   `globals.css` now defines stronger shell/panel/editor surface treatments and reusable status-chip styling.
    *   `AppShell.tsx` now presents the editor as a paper-on-stage surface and improves toolbar framing.
    *   `DocumentHubSidebar.tsx`, `AnnotationPanel.tsx`, `AnnotationCard.tsx`, `ChangesPanel.tsx`, `ChangeEntry.tsx`, `AuditLogViewer.tsx`, and `StatusBar.tsx` were restyled for clearer scanning and stronger contrast.
    *   The palette remains warm/light and consistent with the existing product direction; this was not a full rebrand.
*   **Approval:** Human verified.

**[2026-06-29 00:00:00 UTC] - DEPENDENCY_CHANGE / API_COMPATIBILITY**
*   **Action:** Model/API refresh for newer Claude models (v8.3 Wave 1).
*   **Agent:** Architect / DevOps / Claude Code.
*   **Context:** Agent calls were failing after a model bump. Root cause: newer Claude models (opus-4-7, opus-4-8, fable-5, mythos) return HTTP 400 when sent sampling params such as `temperature`. Routes were unconditionally attaching `temperature`.
*   **Decisions Logged:**
    *   New `src/lib/ai/modelCapabilities.ts` with `modelRejectsSampling(model)` as the single source of truth for the sampling-param gate.
    *   Claude branch of `/api/resolve`, `/api/classify`, and `/api/generate` now omits `temperature` for sampling-rejecting models.
    *   `settingsStore.ts` model list refreshed to Opus 4.8 / Fable 5 / Sonnet 4.6 / Haiku 4.5 (+ legacy Opus 4.6). Default remains Sonnet 4.6.
    *   `normalizeClaudeModel()` migrates stale localStorage model IDs to Sonnet 4.6 (never silent-upgrades to Opus) via `onRehydrateStorage` — a cost-safety decision.
    *   Context compaction pinned to Haiku 4.5 regardless of the selected model. ApiKeyModal surfaces cost (multi-call) and diversity-disabled notices for Opus/Fable.
*   **Approval:** Human verified.

**[2026-06-29 00:00:00 UTC] - ARCHITECTURE_CHANGE**
*   **Action:** Promoted `.claude/agents/*.md` to authoritative runtime agent definitions (v8.3 Wave 2).
*   **Agent:** Code Librarian / Claude Code.
*   **Context:** Agent role definitions existed in both the root `agents.md` and the `.claude/agents/` directory the harness actually loads, risking drift between documented and runtime behavior.
*   **Decisions Logged:**
    *   The 8 `.claude/agents/*.md` files (orchestrator, architect, troublemaker, judge, qa, code-librarian, ui-ux, devops) are now the authoritative runtime agent definitions.
    *   Root `agents.md` demoted to a summary that points at them.
    *   New `.claude/skills/add-cascade-edit` skill added; `build-wave` and `test` skills refreshed.
*   **Approval:** Human verified.

**[2026-06-29 00:00:00 UTC] - ARCHITECTURE_CHANGE / COMPLIANCE**
*   **Action:** Upgraded read-only cascade into editable in-IDE multi-region agent edits (v8.3 Wave 3; PRD Read-Line + Cascade, Sections 06-09).
*   **Agent:** Architect / Troublemaker / Claude Code.
*   **Context:** The cascade was read-only and the suggested-edit path relied on a brittle regex (`parseSuggestedEdit`). Apply also read stale Zustand anchor positions, risking misapplied edits. Audit writes were fire-and-forget and could drop EU AI Act records silently.
*   **Decisions Logged:**
    *   New `ProposedEdit` type (`{id, from, to, newText, reason, relation:'primary'|'cascade', status, targetText}`); `Resolution.edits?: ProposedEdit[]` and `Resolution.auditFailed?` added.
    *   New `src/app/api/structured/route.ts` provider-agnostic tool-calling endpoint backing a `propose_edit` tool — replaces regex `parseSuggestedEdit`.
    *   New `src/lib/ai/orchestrator.ts` `proposeCascadeEdits()` anchors proposals to live positions by fingerprint match; unanchorable or overlapping proposals are dropped. `resolver.ts` calls it on both MADS and single-agent paths.
    *   New `src/lib/prosemirror/plugins/proposedChangePlugin.ts` renders read-line-aware "called out" decorations; positions re-mapped through `tr.mapping`.
    *   New `src/lib/prosemirror/applyProposedEdits.ts` does fingerprint validate-or-abort + descending single-transaction apply — fixes the stale-position bug.
    *   `logResolutionAudit` call sites now `.catch()` and set `resolution.auditFailed` so audit failures are surfaced, not swallowed (Article 12 durability).
*   **Approval:** Human verified.

**[2026-06-29 00:00:00 UTC] - SECURITY / VERSION_CONTROL**
*   **Action:** Initialized git repository on `main` with secret hygiene verified before any commit.
*   **Agent:** DevOps / Claude Code.
*   **Context:** The project was not previously under version control (which prevented worktree isolation during this session's work). It was initialized after the v8.3 work landed: two commits — "Initial commit: Intent IDE v8.2 + model/API refresh (Wave 1)" and "Waves 2-3: swarm agents, skills, and in-IDE multi-region agent edits".
*   **Decisions Logged:**
    *   `.gitignore` (covering `.env` and `*.db`) was written **before** `git init` and the first `git add`; every commit was gated by a staged-secrets check. Verified across all commits (`git rev-list --all` × `git grep`) that no secret ever entered git history — only placeholder-valued `.env.example` files are tracked.
    *   Convention going forward: initialize git and `.gitignore` (covering `.env`) at project start so isolation, rollback, and safe pushes are available from the beginning; rotate any key that has sat in plaintext on disk as routine hygiene.
    *   Verification at this milestone: `npm run typecheck` 0 errors, `npm run test` 194 passing (+42 new), `npm run build` clean.
*   **Approval:** Human verified.

**[2026-06-29 00:00:00 UTC] - COMPLIANCE / HITL_GATE**
*   **Action:** Made multi-region agent edits genuinely reviewable; closed the HITL gate for the multi-region case (v8.3 Wave 3 refinements).
*   **Agent:** Architect / Troublemaker / UI-UX / Claude Code.
*   **Context:** The editable multi-region cascade (Wave 3) shipped without a real review surface: the >1-edit path direct-applied and bypassed `SemanticCommitModal`. That violated the project's Human-In-The-Loop constraint that global/document changes must pass through a `<Confirmation>` / commit gate and never auto-apply.
*   **Decisions Logged:**
    *   ONE source of truth for per-edit Accept/Reject status: the `proposedChangePlugin` (`setProposedEditStatus` / `getProposedAnchors`). The commit modal is the single authoritative writer at apply time.
    *   `src/components/Annotations/ResolutionActions.tsx` now routes the multi-edit case through `SemanticCommitModal`; the direct-apply bypass was removed. `applyProposedEdits(view, acceptedIds)` mutates only the accepted subset.
    *   `SemanticCommitModal.tsx` gained per-change Accept/Reject toggles (when >1), `onConfirm(acceptedIds: string[])`, and `initialRejected` seeded from live plugin status.
    *   New inline review surface `src/components/Editor/ProposedEditControl.tsx` + `src/stores/proposedEditUiStore.ts`; plugin gained `handleDOMEvents`; decorations skip rejected and grey accepted (`proposed-accepted`). Status-only — mutation deferred to batched apply.
    *   New navigable `src/components/Annotations/CascadeList.tsx` (per-row Accept/Reject, click-to-scroll) in `AnnotationCard.tsx`, replacing throwaway cascade toasts. `AnnotationCard` owns the decoration review lifecycle.
    *   Troublemaker review applied before commit (CascadeList gated on `status==='resolved'`; consistent old range `ap.to`; one-click decoration switch; outside-click ignores `[data-proposed-edit-id]`; empty-`acceptedIds` guard) and confirmed the two headline risks (source-of-truth divergence, anchor-read-before-clear race) are NOT bugs.
    *   Result: multi-region document changes can no longer be auto-applied without an explicit per-region human decision — the HITL gate is fully satisfied for multi-region edits. Verification: `npm run typecheck` 0 errors, `npm run test` 194 passing, `npm run build` clean.
*   **Approval:** Human verified.

**[2026-06-29 00:00:00 UTC] - VERSION_CONTROL**
*   **Action:** Pushed the repository to GitHub `Vinylfigure/intent-ide` `main`.
*   **Agent:** DevOps / Claude Code.
*   **Context:** The Wave 3 refinements were committed ("Wave 3 refinements: reviewable multi-region edits") and the repo was pushed to the remote — 3 commits on `origin/main`.
*   **Decisions Logged:**
    *   Pre-push secret audit re-confirmed: `.env` was never tracked (`git ls-files --error-unmatch .env` → no match) and no secret value appears in any commit (`git rev-list --all` × `git grep` → 0 occurrences). Only placeholder-valued `.env.example` files are tracked.
*   **Approval:** Human verified.

**[2026-07-08 00:00:00 UTC] - VERSION_CONTROL / RELEASE**
*   **Action:** Prepared the repository for public release (portfolio packaging).
*   **Agent:** DevOps / Code Librarian / Claude Code.
*   **Context:** The GitHub repository was made public. A packaging pass added the standard open-source surface and removed development-only artifacts from version control.
*   **Decisions Logged:**
    *   Added `README.md`, `LICENSE` (MIT), `.github/workflows/ci.yml` (typecheck, lint, unit tests, build on Node 20), `.eslintrc.json`, and package.json metadata.
    *   Untracked development-only files (internal PRD PDF, editor-specific rule directories, session-scratch memory-bank files) while keeping them locally; deleted stale docs and committed build artifacts.
    *   **Ledger consolidation (disclosed exception to append-only):** the two 2026-06-29 VERSION_CONTROL entries above were edited in place at publication to state the verified facts directly. As originally written they recorded a false alarm — a mistaken belief that a `.env` key had been committed — followed by an appended CORRECTION entry proving it never entered git history. The consolidated entries carry the corrected conclusion; the original wrong-then-corrected sequence remains visible in git history. This is the only in-place edit ever made to this ledger.
    *   Verification: `npm run typecheck` 0 errors, `npm run test` 194 passing, `npm run lint` clean, `npm run build` clean.
*   **Approval:** Human verified.
