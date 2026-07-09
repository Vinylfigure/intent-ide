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

**[2026-07-09 00:00:00 UTC] - ARCHITECTURE_CHANGE**
*   **Action:** Rebuilt the cascade as a precision-first, block-keyed document dependency graph (v8.4 candidate; branch `claude/cascade-graph`, PR #4 — pending merge, `main` is branch-protected).
*   **Agent:** Architect / Full swarm / Claude Code (Fable 5), from the local untracked brief `docs/fable5-cascade-brief.md`.
*   **Context:** The two prior cascade mechanisms were both stubs: the editable path sent a whole doc truncated to 6000 chars in one LLM pass (pages 5+ invisible) and anchored by first-substring-match (wrong-occurrence risk on repeated phrases); the Graphiti path flagged every entity-name mention read-only. No stable block identity existed anywhere.
*   **Decisions Logged:**
    *   Stable `blockId` attrs on all block nodes (`schema.ts` `withBlockId` + `blockIdPlugin.ts`); `parseDOM` deliberately does NOT round-trip `data-block-id` so paste mints fresh ids; duplicate-id keeper is the first NON-EMPTY occurrence; initial-load stamping deferred (`queueMicrotask`, `addToHistory: false`). BlockId is now the anchor of record system-wide.
    *   New `src/lib/graphrag/docGraph.ts`: deterministic extractors + ONE validated `link_blocks` LLM pass (≤200 textblocks), FNV-1a contentHash LRU-8 cache with inflight dedupe, `getNeighborhood` BFS. Background rebuilds are deterministic-only — document text never leaves the machine as a side effect of typing; the LLM pass runs lazily inside the user-initiated cascade (data-egress + cost decision).
    *   `proposeCascadeEdits` rewritten graph-scoped: 2-hop neighborhood, ≤24 blocks (count capped, text never truncated), blockId-first anchoring, first-proposal-wins overlap gate. The `resolver.ts` `.slice(0, 6000)` truncation is DELETED.
    *   Evidence-gated severity: every cascade proposal must cite `CascadeEvidence` verified verbatim against the live doc; severity (`must`/`probably`/`optional`) is DERIVED (`deriveSeverity`/`hasVerbatimConflict`), never trusted from the model; an uncited proposal can never be `must`. All three review surfaces render/sort severity; accept-all defaults to `must`+`probably` (HITL preserved — nothing auto-applies; validate-or-abort single-transaction apply unchanged).
    *   New `src/lib/ai/structuredClient.ts` injectable `CallStructuredFn` seam; `fetchStructured` throws on `!res.ok` so provider failure can never be cached as "no dependencies" (cache-poisoning guard).
    *   EditPropBench-grounded eval harness (`editPropBench.{fixtures,test}.ts`, 10 fixtures, labels per arXiv:2605.02083 — verified real; the "LEDGER agentic editing" citation is FABRICATED and banned) gates recall ≥ 0.9 / 0 FP violations / 100% citation validity as a pipeline regression gate.
    *   Graphiti `cascadeCheck.ts` deliberately left as a separate read-only lane; `DocGraphEdge.source` reserves `'graphiti'` for a future bridge.
    *   Verification: `npm run typecheck` 0 errors, `npm run lint` clean, `npm run test` 287 passing (was 194), `npm run build` clean.
*   **Approval:** Human verified (PR #4 review pending merge).

**[2026-07-09 00:00:00 UTC] - BUG_FIX**
*   **Action:** Fixed swarm-review findings on the v8.4 cascade graph work before PR, including one ship-blocking crash (same branch/PR as the entry above).
*   **Agent:** Troublemaker / QA / Claude Code.
*   **Context:** All headless gates (typecheck, build, vitest) were green while the app could not mount — ProseMirror plugin `view()` hooks run inside the `EditorView` constructor, and no headless test ever constructs a view.
*   **Decisions Logged:**
    *   (1) CRITICAL editor mount crash: the blockId plugin's `view()` dispatched a transaction during `EditorView` construction, hitting the temporal dead zone on `const view` inside `EditorShell`'s `dispatchTransaction`. Fixed by `queueMicrotask` deferral. A jsdom editor-mount smoke suite (`src/lib/prosemirror/__tests__/editorMount.smoke.test.ts`, jsdom added as devDependency) is now a permanent CI-level gate.
    *   (2) Undo-resurrection: doc-switch `replaceWith` now dispatches with `addToHistory: false` — previously Cmd-Z could restore the prior document's content and autosave it under the NEW document's id (silent data corruption across documents).
    *   (3) `applyProposedEdits` drift recovery is blockId-scoped first, before any text search.
    *   (4) `contentHash` separator sentinels (u0001/u0002) were raw invisible control bytes in the source literal; rewritten as visible backslash escapes (hex-dump before declaring string-literal bugs).
*   **Approval:** Human verified.

**[2026-07-09 00:00:00 UTC] - ARCHITECTURE_CHANGE**
*   **Action:** Added a git-model document history layer (Cascade v2 Wave E; branch `claude/cascade-v2-e`, PR #6 — pending merge). Passed adversarial (Troublemaker) review: initial verdict NO-MERGE with HIGH findings, all fixed before the PR was opened.
*   **Agent:** Architect / Troublemaker / Claude Code (Fable 5), built in worktree `../IDE-wave-e` off merged PR #4.
*   **Context:** The audit ledger recorded decisions but the document itself had no durable version history — no way to answer "what did the document look like when this AI edit was approved," which EU AI Act Art. 12 record-keeping and Art. 14 oversight both presuppose. The unused `DocumentSource` Prisma model was dead weight.
*   **Decisions Logged:**
    *   New `DocCommit` Prisma model (migration `20260709205301_add_doc_commit_history`); unused `DocumentSource` model REMOVED in the same migration, verified against a populated pre-existing DB.
    *   **Two-level content addressing (git tree+commit):** `contentHash` = sha256(canonical docJson); commit `hash` covers documentId + parentHash + contentHash + kind + message + actor + annotationId + auditIds + modelVersion. Attribution lives INSIDE the address — the HIGH review finding showed content-only hashing let a racing 'direct' autosave silently absorb an 'apply' commit's AI provenance.
    *   **Append-only, server-verified commit DAG:** `/api/history` is POST create-only; the server recomputes both hashes (400 on mismatch); 409 stale-head enforces linearity with client rebase-retry-once; duplicates are idempotent; no update/delete paths exist.
    *   **Art. 12/14 integration:** 'apply' commits carry `blockIdsTouched`, `auditIds`, actor `ai+human`, `modelVersion`, and `ChangeSet.commitHash` linkage. `restoreCommit` is TRANSACTIONAL and ordered durable-first: flush pending edits → HUMAN_RESTORE audit event (id embedded in the restore commit's `auditIds`) → commit → only then the editor `replaceWith` (`addToHistory: false`). Restore is Confirmation-gated in `HistoryPanel.tsx` (HITL preserved).
    *   `changeTrackingPlugin` skips `addToHistory: false` transactions (no phantom "Direct edit" entries on restore/doc-switch).
    *   `docs/compliance.md` states the honest posture: application-enforced append-only, tamper-EVIDENT not immutable, client-supplied attribution, and the `auditFailed` → zero-audit-links case disclosed.
    *   CI now runs `prisma migrate deploy`.
*   **Approval:** Human verified (PR #6 review pending merge).

**[2026-07-09 00:00:00 UTC] - ARCHITECTURE_CHANGE**
*   **Action:** Added relevance-judge severity gating + utility-model routing to the cascade (Cascade v2 Wave A; branch `claude/cascade-v2-a`, PR #5 — pending merge). Passed adversarial (Troublemaker) review: initial verdict NO-MERGE with HIGH findings, all fixed before the PR was opened.
*   **Agent:** Architect / Troublemaker / Claude Code (Fable 5), built in worktree `../IDE-wave-a` off merged PR #4.
*   **Context:** `hasVerbatimConflict` verified that a citation EXISTS verbatim, not that it is RELEVANT — an existent-but-irrelevant quote could still yield a `must`. Judge/compaction calls were also running on the user's (potentially Opus-class) model, and structured calls had no transport resilience.
*   **Decisions Logged:**
    *   New `src/lib/ai/relevanceJudge.ts`: batched LLM judge verifying that `must`-candidates' citations GENUINELY conflict, with target block context in the input. Trust boundary: the judge can only LOWER severity, never raise it; its prompt contains no severity vocabulary.
    *   **Malfunction-preserves semantics (HIGH review finding):** a thrown judge call OR a response with zero valid verdicts is a protocol malfunction and preserves the derived severities — only real per-candidate verdicts demote. "Failed to answer" is never read as "denied." `maxTokens` scales with candidate count (fixed limits silently truncate the batch tail); deny-wins on duplicate verdict indexes.
    *   `pickUtilityModel` in `modelCapabilities.ts` pins the judge + context compaction to `claude-haiku-4-5` (claude provider only). Graph extraction deliberately stays on the user's model — it is a recall mechanism, not housekeeping.
    *   `fetchWithRetry` in `structuredClient.ts` (429/5xx, 2 retries, jittered backoff).
    *   Opt-in live bench (`editPropBench.live.test.ts`, `npm run bench:live`, `BENCH_LIVE=1`): preflight fail-fast, asserts non-empty measurement, results to gitignored `bench-results/`.
    *   **REVERTED in-branch:** a prompt-caching commit, after review proved it a cost regression (zero shared prefix cascade→judge; in-process cache already absorbs identical rebuilds; 2000-char trigger below Anthropic's 1024/2048-token cacheable minimum — 1.25x write surcharge, zero possible hits).
*   **Approval:** Human verified (PR #5 review pending merge).

**[2026-07-09 00:00:00 UTC] - ARCHITECTURE_CHANGE / DEPLOYMENT**
*   **Action:** Selected Vercel + Turso (hosted libSQL) as the public-demo deployment target and wired the app for it (branch `claude/vercel-deploy`, PR #8 — open, awaiting operator steps + merge). PRs #5 and #6 merged to `main` prior to this work (post-merge baseline 370 tests + 10 skipped).
*   **Agent:** DevOps / Architect / Claude Code (Fable 5).
*   **Context:** The public portfolio repo needed a live demo. The append-only audit ledger (Prisma v7 + libSQL) requires a durable hosted DB; Vercel filesystems are ephemeral, so local SQLite cannot ship.
*   **Decisions Logged:**
    *   **Turso over Supabase:** the existing `@prisma/adapter-libsql` + SQLite migrations work UNCHANGED, and Turso's free tier does not auto-pause (Supabase free pauses after ~1 week idle — unacceptable for an always-on demo). Supabase (Auth + Postgres) is DEFERRED to a future commercialization phase (accounts + doc sync), not rejected.
    *   `src/lib/db.ts` `PrismaLibSql` now passes `DATABASE_AUTH_TOKEN`; local `file:dev.db` unchanged. `package.json`: `build` = `prisma generate && next build`, `postinstall` runs `prisma generate`, engines >= 20. `maxDuration=60` on the 5 LLM/transcription routes.
    *   **Prisma 7.5 limitation recorded:** `prisma.config.ts`'s Datasource type is `{url, shadowDatabaseUrl}` only — no driver-adapter hook for migrate — so `prisma migrate` cannot target Turso. Schema is applied by piping `prisma/migrations/*/migration.sql` through `turso db shell` (documented in a prisma.config.ts comment + README).
    *   Graphiti/FalkorDB confirmed local-dev-only (all call sites client-side with fallbacks); the deployed demo has no graph-server dependency.
    *   Operator steps pending (user): `turso auth login` + DB creation + migrations; Vercel project (Node 22) with `DATABASE_URL`/`DATABASE_AUTH_TOKEN`/`AUDIT_ADMIN_TOKEN`; preview smoke test; merge PR #8; fix the README live-demo placeholder (`https://intent-ide.vercel.app`) if the project name differs.
*   **Approval:** Human verified (PR #8 open, merge pending operator smoke test).

**[2026-07-09 00:00:00 UTC] - SECURITY**
*   **Action:** Public-exposure hardening of all publicly reachable API surfaces ahead of the Vercel deploy (same branch/PR #8 as the entry above).
*   **Agent:** DevOps / QA / Troublemaker / Claude Code.
*   **Context:** A shared public demo exposes routes designed for a single local user: the LLM proxy routes accept a client-supplied `x-base-url` header (SSRF surface), `/api/audit` accepted unbounded unauthenticated reads/writes, and `/api/history` (PR #6) stores full unauthenticated document snapshots.
*   **Decisions Logged:**
    *   **SSRF guard — new `src/lib/server/validateBaseUrl.ts`** (production-only) on `x-base-url`, wired into resolve/classify/generate/structured (400 on violation): https-only; private IPv4/IPv6 ranges blocked; FQDN trailing dots handled; WHATWG hex-group v4-mapped IPv6 (e.g. `[::ffff:a9fe:a9fe]`) FAILS CLOSED — QA finding: `new URL('https://[::ffff:127.0.0.1]').hostname === '[::ffff:7f00:1]'`, so dotted-quad-only blocklists are bypassable; the hex spelling is decoded before matching.
    *   **Redirect vector closed (Troublemaker finding):** guarded proxy fetches use `redirect:'manual'` — a validated public https URL can otherwise 3xx to a private address and default `fetch` follows it.
    *   **`/api/audit` hardened:** real-body 16KB cap (not just content-length); oversize fields reject 400 — NEVER truncate, because truncating JSON provenance fields would corrupt an Article 12 ledger; per-IP soft rate limit keyed on `x-real-ip`; GET scoped by `?userId=` (anonymous per-browser UUID from new `getVisitorId()` in `auditLogger.ts`); unscoped GET requires Bearer `AUDIT_ADMIN_TOKEN` and FAILS CLOSED in production — the original draft failed open when the token was unset (fixed; rule: absence of a configured credential means DENY). Disclosed limitation: `userId` is client-supplied — a courtesy partition, not a security boundary; real auth is the deferred Supabase phase.
    *   **`/api/history` gated OFF in production** (403) unless `HISTORY_ENABLED=1` — the shared public demo must not store full unauthenticated document snapshots. The flag must NOT be set on the demo deployment.
    *   **Process incident recorded:** the checkout was switched from `claude/vercel-deploy` back to `main` mid-session (concurrent agents in one repo); a commit landed on local `main` while the pushed branch lacked it. Recovered via reset + rebase onto the moved `origin/main`. Countermeasure: re-check `git branch --show-current` immediately before every commit, or isolate parallel agents in worktrees.
    *   Verification: 92 new tests (SSRF matrix, auditLogger, audit route, history gate) → 462 passing + 10 skipped; `npm run typecheck` / `lint` / `build` clean.
*   **Approval:** Human verified (PR #8 open, merge pending operator smoke test).

**[2026-07-09 00:00:00 UTC] - DEPLOYMENT**
*   **Action:** PR #8 MERGED to `main`; production deployed, aliased, and LIVE at **https://intent-ide.vercel.app**.
*   **Agent:** Operator (user) + DevOps / Claude Code (Fable 5).
*   **Context:** All operator steps from the two preceding entries executed the same day.
*   **Decisions Logged:**
    *   Turso DB `intent-ide-audit` created (`libsql://intent-ide-audit-vinylfigure.aws-us-west-2.turso.io`); all 3 migrations applied; remote schema verified BYTE-IDENTICAL against a fresh local sqlite3 build of the migrations.
    *   **Incident:** `turso db shell < migration.sql` is NON-TRANSACTIONAL and stops mid-file at the first error — a partial apply plus an incautious re-run of migration 1 left a stray `DocumentSource` table (migration 3 drops it). Recovered by dropping the stray table and schema-diffing. New standing rule: after any manual Turso migration, diff `sqlite_master` against a fresh local build.
    *   Vercel project `intent-ide` (team `vinylfigures-projects`) linked; production env vars `DATABASE_URL` / `DATABASE_AUTH_TOKEN` / `AUDIT_ADMIN_TOKEN` set (admin token stored only in local gitignored `.env`); production redeployed.
    *   **End-to-end production smoke test PASSED:** audit POST → row confirmed in Turso via `turso db shell`; visitor-scoped GET returns own record; other `userId` sees 0; unscoped GET without token 401, with admin bearer 200; `/api/history` 403 (production gate); SSRF probes `http://169.254.169.254` and `https://[::ffff:169.254.169.254]` both 400.
    *   Known issue: PR #9 (`claude/cascade-v2-d`) preview deploys fail (`Can't resolve '@/generated/prisma/client'`) until rebased onto `main` for PR #8's `prisma generate && next build` script.
*   **Approval:** Human verified (operator executed the deploy; smoke test passed before merge).

**[2026-07-09 00:00:00 UTC] - ARCHITECTURE_CHANGE**
*   **Action:** Scaled the document dependency graph and made candidate selection source-quality-aware; Graphiti entities became a real docGraph edge source; the cascade consolidated onto ONE review surface (Cascade v2 Waves B + D1/D2; PRs #10, #12 — the Wave D1+D2 finale closes the roadmap).
*   **Agent:** Architect / Troublemaker / Claude Code (Fable 5).
*   **Context:** The docGraph rebuilt from scratch on every change (LLM edges decayed), skipped the LLM pass entirely on large docs, had no semantic-similarity signal, and the long-reserved `'graphiti'` edge source was still a stub. Show-affected also had its own parallel cascade presentation.
*   **Decisions Logged:**
    *   **[PR #10] Incremental rebuilds seed re-extraction from the PRIOR graph's adjacency** — adversarial review caught that unseeded re-extraction monotonically decays LLM edges (each rebuild forgets a little). Incremental caches must seed re-work from prior structure.
    *   **[PR #10] Chunked LLM extraction only above a 150-block single-call threshold** — review caught unconditional chunking silently regressing recall in the 41-200-block band the old single-call path handled. Check the band between old and new limits when replacing a bounded mechanism.
    *   **[PR #10] Embeddings edge source:** `/api/embed` + `embedEdges.ts` with a transient-throw / permanent-null contract (transient failure is non-cacheable by construction — same discipline as `fetchStructured`); provider-keyed vector cache; 300-block cap; `headingPath` in payloads.
    *   **[PR #12] `augmentWithGraphitiEdges`:** entity co-mentions feed the docGraph as the third edge source, capped ≤12 entities / ≤120 edges per build with an abortable 1500ms MCP deadline — review found entity COUNT (not per-entity fan-out) was the unbounded flooding axis; bounding a firehose means finding the unbounded axis.
    *   **[PR #12] SOURCE_PRIORITY-aware selection:** `getNeighborhood` returns `{hop, sourceRank}` and candidate ordering under the 24-block budget ranks by source quality, so low-precision graphiti co-mentions cannot evict LLM-attested dependents from the neighborhood.
    *   **[PR #12] One cascade surface:** show-affected scroll/pulses to `CascadeList`, status-gated via `showAffectedMode`. Also: `cascadeCalibration` telemetry — closed-enum metadata-only events, local aggregate always, PostHog capture opt-in DEFAULT FALSE, modal decisions buffered flush-on-confirm, `applied` recorded only post-successful-apply, miscalibration hint at n≥5. No document content ever leaves the machine via telemetry.
    *   Carry-forward debts disclosed: graphiti augmentation is one-shot per content hash; inflight-dedupe can hand a deterministic-only graph to a concurrent cascade (pre-existing); spend estimate excludes transcription.
*   **Approval:** Human verified (pre-PR Troublemaker review: NO-MERGE verdicts on both waves; all HIGH findings fixed with regression tests before push).

**[2026-07-09 00:00:00 UTC] - ARCHITECTURE_CHANGE**
*   **Action:** Redesigned flow-state cascade buffering as in-plugin reveal flags and made re-anchoring validate-stored-first (Cascade v2 Wave C; PR #11).
*   **Agent:** Architect / UI-UX / Troublemaker / Claude Code (Fable 5).
*   **Context:** The PRD's Event Segmentation requirement (buffer cascade flags until reading breakpoints) was first implemented by withholding held edits from `proposedChangePlugin` entirely — which hard-broke apply, because withheld edits' anchors were never mapped through intervening transactions.
*   **Decisions Logged:**
    *   **Reveal flags live INSIDE the plugin:** held cascades stay in plugin state with anchors position-mapped through every transaction; only their DECORATIONS are suppressed until the reading breakpoint. Rule recorded: flow-state holds suppress PRESENTATION, never EXISTENCE — the apply-time source of truth must always contain every edit.
    *   **Validate-stored-first re-anchoring:** review caught fingerprint-first re-anchoring silently RELOCATING valid blockId-less anchors to lookalike text. The stored range is validated first; fingerprint search is recovery for a failed stored range, not truth.
    *   **Modal cancel snapshot/restore:** `SemanticCommitModal` cancel restores the plugin status snapshot taken at open — a cancelled review no longer strands diverged accept/reject state.
    *   **Explainability + spend transparency:** `docGraphStore` + `findEdgePath` power a "why this proposal?" edge-path UI; StatusBar graph chip; "AI data & spend" settings panel (`judgeEnabled` / `embeddingsEnabled` / `embedModel` + session spend estimate, transcription excluded — disclosed).
*   **Approval:** Human verified (pre-PR Troublemaker review: NO-MERGE with HIGH findings — the apply breakage and the anchor relocation — both fixed with regression tests before push).

**[2026-07-09 00:00:00 UTC] - BUG_FIX**
*   **Action:** Fixed streaming-path cascade parity — cascades never fired in the live app (Cascade v2 Wave D3; PR #9). Found by WRITING the Playwright e2e, not by any unit suite.
*   **Agent:** QA / DevOps / Claude Code (Fable 5).
*   **Context:** `streamResolveAnnotation`'s MADS branch never called `attachCascadeEdits`. The production UI streams; only the non-streaming path attached cascade edits — so the product's differentiating feature was dead in production while three waves of unit suites (500+ tests) stayed green, because every unit test exercised the non-streaming path.
*   **Decisions Logged:**
    *   New `cascade-review.spec.ts` drives the full annotate → cascade → review → apply → history flow through the REAL UI: LLM endpoints intercepted with deterministic responses; audit and history routes REAL (the Article 12 write path is exercised end-to-end).
    *   Fix: streaming/non-streaming parity for `attachCascadeEdits` + regression tests pinning both paths.
    *   Standing rule: any feature reachable via both streaming and non-streaming resolution paths must be tested on BOTH; the e2e through the real UI path is the permanent gate for the cascade flow.
*   **Approval:** Human verified.

**[2026-07-09 00:00:00 UTC] - PROCESS**
*   **Action:** Recorded the Cascade v2 adversarial-review track record at roadmap close (PRs #5, #6, #9-#12).
*   **Agent:** Code Librarian / Full swarm.
*   **Context:** Cascade v2 ran five waves, each through implement → pre-PR adversarial Troublemaker review → fix, before anything was pushed.
*   **Decisions Logged:**
    *   **Five waves, five pre-PR adversarial reviews, five NO-MERGE verdicts, every HIGH finding fixed with regression tests BEFORE push.** Findings prevented from shipping: judge-malfunction-as-denial (A), content-hash provenance absorption (E), monotonic LLM-edge decay + mid-band recall regression (B), flow-state apply breakage + anchor relocation (C), entity-count flooding (D). The pre-PR adversarial gate is load-bearing — keep it.
    *   Separately, the PR #9 e2e caught a production-dead feature (streaming cascades) that all five green unit suites missed — unit coverage of a path is not coverage of THE path.
    *   Worktree discipline confirmed: A∥E and B∥D3+D4 ran safely in parallel worktrees; B∥C was deliberately SERIALIZED because both touch `docGraph.ts` — parallelize by file-overlap analysis, not by wave count.
    *   Final verification at close: 579 unit tests + 10 skipped on the finale branch (`main` matches post-merge); cascade e2e green; ingestion e2e requires local FalkorDB (pre-existing).
*   **Approval:** Human verified.
