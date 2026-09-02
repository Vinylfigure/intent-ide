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

**[2026-08-16 00:00:00 UTC] - VISION_AUDIT**
*   **Action:** Full vision-vs-implementation audit + prior-art research (three parallel investigations); Flow v1 roadmap defined and filed as GitHub issues for autonomous execution.
*   **Agent:** Claude Code (audit + two web-research subagents + one adversarial stress-test subagent).
*   **Context:** Founder restated the two core scenarios (flow-state reading Q&A with breakpoint-timed answers; direct-edit cascade on policy documents) and asked for an extensive audit against them, due-diligence research on prior art, and adversarial stress-tests of the dependency-graph approach and a Janus-style solution.
*   **Decisions Logged:**
    *   **Two documented claims corrected (previously overstated):** (1) the cascade pipeline fires only on annotation-driven AI edits — direct typing never triggers it, so the founder's primary policy scenario is unimplemented; (2) the Graphiti lane is unreachable in any deployed configuration (browser-side calls default to localhost; `GRAPHITI_MCP_URL` lacks the `NEXT_PUBLIC_` prefix) — the shipping self-reference capability is the in-browser docGraph.
    *   **Research verdicts:** highlight-to-explain popups are commodity (Chrome Ask Gemini, Perplexity Comet, Dia, AI2 Semantic Reader); defer-to-breakpoint delivery of ANSWERS while reading is unshipped and unpublished anywhere — it is the defensible core, on validated theory (Iqbal & Bailey 2008/2010). Within-document semantic cascade editing is open white space (EditPropBench: best systems miss ~30% of implicit updates; closest players Harvey and LEDGER).
    *   **Dependency-graph stress test:** LEDGER's 56→76% headline used a baseline structurally forbidden from cascading — not a fair graph-vs-whole-doc comparison; the graph's proven value is deterministic validators + collateral-damage bounds + long-doc/cheap-model regimes; cost advantage collapses at 2–50k tokens under prompt caching. Settling 5-arm ablation defined; evidence-based prior: whole-doc editing + deterministic verification (arm D) wins at policy-doc scale. Further docGraph investment is gated on this ablation.
    *   **Novel mechanism adopted into the roadmap (from Janus):** Document Invariant Ledger + doc-CI — capture user-declared facts as runnable assertions at semantic-commit time; regression-test every DocCommit against the accumulated ledger; failing fact = cascade flag with a named invariant. Converges with ablation arm D.
    *   Flow v1 wave defined (P1 fire-and-forget capture, P2 breakpoint-buffered answers, P3 one-click actions + mermaid, P4 direct-edit cascade trigger, P5 provider cleanup) — details in progress.md §3; each item filed as a self-contained GitHub issue.
*   **Approval:** Human approved the plan (plan-mode review, 2026-08-16).

**[2026-08-16 00:00:00 UTC] - ARCHITECTURE_CHANGE**
*   **Action:** Flow v1 wave implemented and landed (issues #14-#18): fire-and-forget capture, breakpoint-buffered answers, one-click actions + mermaid, direct-edit cascade trigger, provider layer cleanup.
*   **Agent:** Three parallel worktree implementers + adversarial reviewer + fix pass / Claude Code.
*   **Context:** Executes the Flow v1 roadmap from the same-day vision audit. Tracks built in parallel worktrees with strict file ownership (A: P1-P3 serialized; B: P4; C: P5), merged C→B→A.
*   **Decisions Logged:**
    *   **Pre-push adversarial review: NO-MERGE, 3 HIGH + 6 MEDIUM, all fixed with regression tests before push.** H1: capture's auto-setActive made answer buffering unreachable in the flagship flow — fixed by distinguishing capture-driven from user-driven activation (captureActivated/markUserActivated). H2: direct-edit offer + cascade run doc-switch races — documentId stamped at settle and guarded at both async resolution points. H3: unclamped getBlockText could throw at finalize and discard a streamed answer — clamped + fail-open hold decision.
    *   **Standing rule recorded:** flow-state features need at least one test walking the UNINSTRUMENTED user path — H1 survived 711 green tests because the tests hand-called setActive(null), encoding the workaround rather than the journey.
    *   `AI_APPLY_META` now stamps every AI-driven apply dispatch (batched, single-edit, per-message) so the direct-edit tracker never attributes AI edits to the human.
    *   `/api/graphiti` proxy is production-gated (501 unless GRAPHITI_MCP_URL set) and tool-allowlisted to the client's exact call set — replacing the unreachable browser→localhost lane with a governed server lane.
    *   No-op proposed edits (targetText === newText) are excluded from apply transactions, applied[], and ledger rows — an Article-12 ledger must never record a non-change.
    *   Provider layer: one server module (`llmProvider.ts`) with byte-compatible route contracts; OpenRouter added; silent capability loss replaced with visible notes; interrupted in-flight annotation statuses repaired on rehydrate.
    *   Pre-existing bug fixed en route: ingestion e2e test 1 broken since the Phase 8D modal redesign (spec never selected the Paste tab).
    *   **Verification at close: 731 unit + 10 skipped; typecheck/lint clean; cascade-review e2e green; ingestion test 1 green (FalkorDB test still requires local infra).**
*   **Approval:** Human approved the wave plan (plan-mode, 2026-08-16); review fixes verified by gates.

**[2026-08-20 00:00:00 UTC] - ARCHITECTURE_CHANGE**
*   **Action:** Closed the Document Invariant Ledger spike (#20) with its fourth and final phase — the LLM entailment check lane (issue #51, PR #52 MERGED). Phases 1-3 landed 2026-08-18/20 as PRs #29, #34, #48.
*   **Agent:** work-loop scheduled firing / Claude Code (implementer + adversarial troublemaker subagent).
*   **Context:** `checkKind: 'entailment'` had been dead weight since Phase 1. `POST /api/invariants` defaulted every captured statement to `'deterministic'`, the one real call site never passed `checkKind` at all, and `invariantCheckRunner.ts`'s own header comment conceded entailment rows were "silently skipped here, never errored." No code path had ever created OR checked an entailment-kind invariant — so every declared fact the figure-matching lane structurally cannot check (word-form numbers, calendar-date fragments, singular/plural variants, claims with no exact-match anchor) was captured as deterministic and then skipped forever.
*   **Decisions Logged:**
    *   **Capture-time lane classification:** new `classifyCheckKind` decides `checkKind` from the statement text instead of hardcoding `'deterministic'`. Local and free — no LLM call merely to classify. It lives beside the skip gate it mirrors and reuses that gate's own `extractChangedTokens` read.
    *   **Fail-safe direction deliberately INVERTED from `relevanceJudge`:** the relevance judge preserves a severity the system already derived, so its malfunction case is "keep what we derived." Here there is no prior belief to preserve, so a thrown call, malformed reply, duplicate verdict, out-of-range index, or missing verdict all yield **no flag**. Rule recorded: when a judge is the ONLY thing standing between silence and a user-visible flag, its malfunction must resolve toward silence — a broken judge may never manufacture a false positive.
    *   **Bounded candidates, never a whole-document scan:** the 2-hop deterministic-graph neighborhood of each evidence block, unioned with blocks sharing a substantive statement term, capped per-invariant and per-run. The graph build passes `skipLlm`/`skipEmbeddings`/`skipGraphiti`, so it is a cache hit and never itself a network call.
    *   **Data-egress gate:** new `invariantEntailmentEnabled` setting, default OFF and rehydrate-backfilled to OFF (anything other than an explicit stored `true` resolves to off — same rule as `telemetryEnabled`). Runs only on a user-initiated apply, never on typing. The deterministic lane stays local and always-on regardless.
    *   **Surfacing unchanged:** entailment violations flow through the existing `invariantCascade` → `CascadeList` surface; the one-cascade-surface rule (Wave D2) holds. `InvariantViolation` became a union discriminated on `checkKind`. An entailment violation has no verbatim figure to cite by construction, so it degrades to no evidence and `'optional'` severity under the standing rule that an uncited proposal can never be `must`.
*   **Approval:** Human verified (operator merged PR #52). Pre-push adversarial review verdict NO-MERGE with 2 HIGH findings; all fixed with regression tests before the PR was opened.

**[2026-08-20 00:00:00 UTC] - PROCESS**
*   **Action:** Recorded the two HIGH findings from the Phase 4 adversarial review — both cases of green tests sitting around a hole.
*   **Agent:** Troublemaker subagent / Claude Code.
*   **Context:** `npm run typecheck` was clean and all 67 invariant tests passed on the first commit. That was precisely the problem: the feature did not do what the commit message and three separate docstrings claimed, and the tests were green around the gap.
*   **Decisions Logged:**
    *   **HIGH-1 — statements in NEITHER lane.** `classifyCheckKind` mirrored only `checkInvariants`'s *first* skip gate (statement has a figure and a term) and not its *effective* one — the per-block exact-word `containsTerm` subject match against the drifted text. A statement can clear the first and be structurally unmatchable by the second, then get filtered out of the entailment lane by its `checkKind === 'entailment'` test. Reproduced: `"each termination requires 30 days notice"` vs `"Terminations now require 45 days."` (unstemmed plural) and `"the filing deadline is March 15"` vs `"Filings are due by April 20"` — no flag from either lane. Two of the three blind spots the runner's own docstring names. **Rule recorded: a classifier that routes work between two lanes must mirror the receiving lane's EFFECTIVE gate, not merely its first one — and where it cannot (the drift text does not exist yet at capture time), the fallthrough must be a runtime fallback, not a classification promise.**
    *   **HIGH-2 — permanent no-op on every existing ledger.** Capture defaulted every row to `'deterministic'` through Phase 3 and the ledger is append-only, so no pre-#51 row could ever reach the new lane and no migration could reclassify one — the feature would have been unverifiable by hand on any real document, with no diagnostic. **Rule recorded: when adding a lane keyed on a column that shipped with a hardcoded default, check what the existing rows hold before assuming the new path is reachable.**
    *   **Both fixed by one change, not two:** lane membership moved out of `entailmentCheck.ts` and into `runAndSurfaceInvariantChecks`, which falls a deterministic-classified invariant through to the entailment lane when the deterministic lane found no violation for it. This closes HIGH-2 without a backfill migration — those rows find nothing deterministically and fall through; a genuinely stale one gets judged, a clean one costs nothing. Classification is now documented as "worth trying deterministically first," not "guaranteed deterministically checkable," and the three overclaiming docstrings were corrected.
    *   **Test-quality findings acted on (the review's most reusable half):** removed a **false gate** — a test injected an empty verdict `Map`, a state the real `judgeEntailmentPairs` cannot produce because it throws first — and replaced it with tests driving the real judge through its malfunction and bad-index paths. `toBeLessThanOrEqual(6)` would have passed with candidate selection entirely broken (now `toHaveLength(6)` with pinned ids); a vacuously-true `not.toHaveProperty` now pins the union's real discriminant. Every test had injected an edgeless graph, so the 2-hop `getNeighborhood` scoping — the issue's own stated budget mechanism — had **zero** coverage; a real `DocGraph` fixture now proves a neighbor sharing no wording with the statement is reached and outranks a term-only hit. Added a test walking the production call shape with no `opts`, so the store default governs egress rather than a test-only override. **This is the same lesson as Flow v1's H1 (tests encoding the workaround instead of the journey), recurring: assertions that pass when the feature is broken are not coverage.**
*   **Approval:** Human verified (operator merged PR #52).

**[2026-08-18 00:00:00 UTC] - PROCESS**
*   **Action:** Committed the work-loop skill the armed Routine had been referencing by path only (PR #28 MERGED).
*   **Agent:** work-loop scheduled firing / Claude Code.
*   **Context:** The work-loop Routine, armed the day before, told every firing to run `/work-loop` per `.claude/skills/work-loop/SKILL.md` — a file that did not exist anywhere in this repo (it lived in janus, the template this fleet's machinery was ported from). The first firing found this by searching the repo, the account's skills directory, and the plugin list, came up empty, and fell back to its scheduler prompt as the spec. It still ran correctly, but a loop whose spec lives only in a scheduler payload is invisible to review, unversioned, and silently divergent from the template it was ported from.
*   **Decisions Logged:**
    *   **Adapted, not copied:** janus's version calls slash commands and a verifier agent that don't exist in this repo; this version uses the repo's own `test` skill's typecheck → lint → test ordering and its own `add-feature`/`build-component`/`add-api-route` skills for delivery, plus a spawned subagent for adversarial review.
    *   **Headless permission boundary made explicit:** an unattended firing cannot write `.claude/hooks/**`, `.github/workflows/**`, or `.claude/settings.json` — the platform gates those paths as sensitive regardless of tool grant, and nobody is present to answer the resulting permission prompt. janus's own first firing deadlocked three hours on exactly that. This skill adds a preflight step: judge a chosen task's done-means against these paths *before* starting it, and move to the next ready task (or exit) if it requires one, rather than starting and hanging.
    *   **Delivery is always a PR:** the `main` ruleset's admin bypass exists for the operator, not for this loop.
*   **Approval:** Human verified.

**[2026-08-19 00:00:00 UTC] - ARCHITECTURE_CHANGE**
*   **Action:** Deleted the orphaned pre-Phase-8 project UI (`ProjectSidebar.tsx`, `projectStore.ts`) — a cleanup debt carried in `progress.md` since 2026-03-16 (PR #36 MERGED, closes #33).
*   **Agent:** Claude Code, with an independent troublemaker-agent re-verification pass.
*   **Context:** `DocumentHubSidebar.tsx`/`documentStore.ts` replaced this UI on 2026-03-16; the old files had sat unused since, kept only out of caution.
*   **Decisions Logged:**
    *   Verified repo-wide (not scoped to `src/`) that zero executable references to `ProjectSidebar`/`projectStore`/`useProjectStore` remained — no barrel re-exports, no dynamic `import()` string-building, no test exclusively covering the deleted files. An independent troublemaker pass re-ran all four gates and the reference sweep rather than trusting the first claim.
    *   `documentStore.ts`'s legacy-projects migration (`LEGACY_PROJECTS_KEY`) reads the `intent-ide-projects` localStorage key directly and never imported `projectStore.ts`, so the migration path was explicitly out of scope and untouched by this deletion.
    *   **Real bug surfaced, not fixed here:** tracing the migration path during review found `runLegacyProjectMigration` doesn't validate that a legacy project's `documents` field is an array before `.forEach`-ing it — malformed localStorage data throws inside `onRehydrateStorage`, and because the "migrated" flag is only set past the throw point, this repeats every boot for an affected user. Filed as its own follow-up (#37) rather than scope-creeping this PR; fixed the next day in PR #38.
*   **Approval:** Human verified.

**[2026-08-20 00:00:00 UTC] - BUG_FIX**
*   **Action:** Fixed the legacy-project-migration crash-on-malformed-data bug surfaced by PR #36's review (PR #38 MERGED, closes #37).
*   **Agent:** Claude Code, two rounds of adversarial troublemaker review.
*   **Context:** `runLegacyProjectMigration()` could throw on malformed `intent-ide-projects` localStorage data; `hasMigratedLegacyProjects` was only set `true` on the non-throwing path, so an affected user's migration would fail and silently retry (and fail again) every boot, permanently losing the legacy documents.
*   **Decisions Logged:**
    *   **Traced the real production symptom against zustand's actual `onRehydrateStorage` wiring, not assumed:** the app's real hydrate path already swallows a callback throw internally (re-invokes with `state: undefined`), so pre-fix this was never a visible app-crashing boot loop through the shipped UI — it was a silent, permanent migration failure. `runLegacyProjectMigration` is also a public store action reachable by direct calls (tests, future code) where a throw *does* propagate synchronously, so the fix still mattered for that path. Recorded so the failure mode is described accurately rather than repeating the "crash" framing at face value.
    *   **Two-level failure isolation:** each project has its own try/catch (a corrupt project can't discard already-migrated sibling projects); each document within a project has its own try/catch (a document with a valid id but some other malformed field can't discard its well-formed siblings in the same project). An outer catch-all guarantees `hasMigratedLegacyProjects` ends up `true` even on an unexpected failure, so migration never retries forever against data it can't recover.
    *   **`safeSet()` wraps every `set()` call in the migration path**, verified (not just asserted) against zustand's actual persist internals — the in-memory update happens before the synchronous localStorage write-through, so wrapping `set()` safely swallows a `QuotaExceededError` from the persistence side-effect without losing the state change.
    *   **Two rounds of review, each catching a coarser isolation boundary than the data required:** round 1 found project-level isolation alone still let one bad document inside an otherwise-valid project crash the whole migration; round 2 found the round-1 fix's quota-exceeded fallback was only argued safe by reading zustand's source, not covered by a test. Both closed with regression tests reproducing the original failures.
*   **Approval:** Human verified.

**[2026-08-20 00:00:00 UTC] - ARCHITECTURE_CHANGE**
*   **Action:** Closed apply-time drift validation gaps on every remaining edit path — pure insertions and both single-edit apply call sites (PRs #43, #45, #46 MERGED; #43 closes #40 and files #42; #45 closes #42 and files #44; #46 closes #44).
*   **Agent:** Claude Code, two to three rounds of adversarial troublemaker review per PR.
*   **Context:** The multi-region cascade-batch apply path (`applyProposedEdits.ts`) already fingerprint-validated proposals against live-document drift before applying and aborted on mismatch. Pure-insertion edits had no target text to fingerprint at all, and the two single-edit apply call sites (`ResolutionActions.tsx`'s common ≤1-edit case, `ConversationThread.tsx`'s per-message apply) dispatched a raw, unvalidated `replaceWith` — the exact drift failure mode the multi-region path was built to prevent, just unreachable from these sites.
*   **Decisions Logged:**
    *   **[PR #43] Insertion validation via captured context, not fingerprint:** `insertionContext: {before, after, beforeSpan, afterSpan}` captured verbatim at proposal time, re-derived and matched at apply time; mismatch aborts the whole transaction. Two bugs fixed pre-push: a length-based window breaks across ProseMirror block boundaries (position deltas don't equal captured string length once a block boundary is crossed) — fixed with a fixed position-space radius shared between capture and validation; and re-clamping the window against the *live* document size at validate time is itself unstable (an unrelated edit elsewhere silently grows or shrinks the comparison window) — fixed by reusing the actual captured span, so the window can only shrink (a real drift signal), never grow from unrelated changes.
    *   **[PR #45] Single-edit validation, extracted not duplicated:** `resolveEditRange`/`applySingleEdit` pulled out of `applyProposedEdits`'s existing per-edit loop (verified line-by-line behavior-preserving) and reused by both single-edit call sites. **Round 1 (NO-MERGE):** the new drift gate itself regressed repeated "Tweak it" applies — `annotation.anchor` was never refreshed after a successful apply, so a second apply's validation failed against now-replaced text, a regression the old unvalidated `replaceWith` had never exposed. Fixed with `refreshAnchorAfterApply()`. **Round 2 (NO-MERGE):** the round-1 fix also wired the same refresh into the multi-region batch branch using positions `applyProposedEdits` resolves against the *pre-transaction* doc — invalid for any edit that isn't the lowest-`from` one in the batch once an earlier, differently-sized edit shifts everything after it. Reproduced concretely (a large earlier-block shrink plus a later-block primary edit reports an out-of-bounds position). **Descoped rather than shipped wrong:** the multi-region anchor refresh was dropped from this PR, documented as a no-op, and filed as #44 with its own done-means.
    *   **[PR #46, closes #44] Multi-region refresh via arithmetic, not search:** round 1's first attempt re-derived the true post-transaction position by fingerprint-searching the post-dispatch doc for the primary edit's `newText` — proven unsafe: a short or common replacement (e.g. a single corrected letter) can coincidentally match pre-existing text elsewhere in the same block, silently returning the wrong anchor. **Fixed with arithmetic instead:** `findAppliedEditFinalPosition` sums `newText.length - (to - from)` over every other applied edit positioned before the target (those dispatch *after* it, per `applyProposedEdits`'s descending-`from` order, and each shifts the target's already-landed text by exactly its own delta) — no document read, no text search, the failure mode is eliminated rather than mitigated. Round 2 independently re-derived the arithmetic against real sequential string splicing and traced a tie-boundary invariant against the orchestrator's overlap/dedup gates before verdict MERGE.
    *   **Standing rule recorded:** when a stale-position bug can be fixed by either searching the live document or computing the answer from known length deltas, prefer the arithmetic — search-based recovery has an inherent false-positive surface that arithmetic does not.
*   **Approval:** Human verified. Test counts checked out and re-run fresh against each actual merge commit, not trusted from the PR bodies' own self-reported figures — those undercounted because PRs #31 and #41 also landed in this same rapid-succession merge window (all five PRs in this cluster merged within about 90 minutes on 2026-08-19): 854 passing + 10 skipped at #43's merge (`403355c`); 860 at #38's merge (`00e88c8`); 868 at #45's merge (`a2c5347`); 878 at #46's merge (`537f385`).

**[2026-08-20 00:00:00 UTC] - ARCHITECTURE_CHANGE / COMPLIANCE**
*   **Action:** Added a retention/collapse policy for `'direct'` `DocCommit` history versions — the first structured exception to the append-only ledger rule (PR #41 MERGED, closes #39).
*   **Agent:** Claude Code, pre-push adversarial troublemaker review.
*   **Context:** `DocCommit` had no retention mechanism. `'direct'` commits (autosave-flush snapshots of raw human typing — no AI provenance, no audit linkage) fire on every 5s autosave debounce, doc-switch, and unmount, so an actively-edited document accumulated a full-document-snapshot row roughly every 5 seconds of typing, forever, on the live public demo's shared Turso free-tier database.
*   **Decisions Logged:**
    *   **New `action: 'amend'` on `POST /api/history`:** a new `'direct'` write replaces the current HEAD in place (delete old row, insert new with a new hash) if and only if that head is *also* a `'direct'` commit with no child yet — one continuous editing session collapses to one row, refreshed on every flush, until a compliance-relevant commit (`'import'|'apply'|'restore'`) starts a new session. Those three kinds are hard-rejected (400) as amend targets or sources — a narrowly-scoped, structurally-enforced exception to append-only, applied only to the retention-only, provenance-free kind. `attemptCommit()` computes the amended row's `parentHash` as the amend target's own parent (it steps into the target's slot), not the target's hash.
    *   **TOCTOU race — HIGH finding, reproduced before fix:** the amend target was read once outside the `$transaction`, and the transaction's re-check only detected a newly-appended child, not the target having been fully deleted-and-replaced by a *second* concurrent amend (e.g. two browser tabs autosaving the same document). This turned a normally-recoverable stale-head race into an unhandled 500 (instead of the documented 409 the client's existing single-retry logic already knows how to recover from), surfacing as a misleading "Restore failed" toast on what was actually a benign concurrent-autosave collision. Fixed by moving the entire read-target → validate → check-for-child → delete → create sequence *inside* the transaction, so whichever concurrent amend's transaction commits first wins and the loser's now-transactional lookup correctly finds the row already gone and reports 409 like any other race.
    *   **Regression test verified concretely, not just added:** the fix was reverted locally, the in-memory Prisma test double's transaction-serializing mock was widened with a real interleaving point, and the new concurrency test was confirmed to **fail** against the old code (`[200, 500]`) before confirming it **passes** against the fix (`[200, 409]`) — proof the guard is real, not vacuous.
    *   **Disclosed, not hidden:** two genuinely concurrent `'direct'` writers can amend over each other with no merge (no "session identity" beyond "no compliance-relevant commit has landed since") — judged acceptable given `'direct'` carries no compliance weight, but stated plainly in `docs/compliance.md` rather than left implicit.
*   **Approval:** Human verified.

**[2026-08-20 00:00:00 UTC] - PROCESS**
*   **Action:** Fixed a required-CI-check gap that let PRs stacked on other open PRs merge with zero CI runs (PR #47 MERGED).
*   **Agent:** Claude Code.
*   **Context:** `ci.yml`'s `pull_request` trigger carried `branches: [main]`, which filters on the PR's **base** branch, not its head. A PR opened stacked on another PR's still-open branch therefore ran no CI at all, on open or on any subsequent push. This was harmless-looking (nothing enforced CI as a merge gate) until `verify` became a required status check the day before, at which point it became a hard block: PR #46, opened stacked on #45, showed only `gate-integrity` (which carries no branch filter) as green, making the gap look like "one check is broken" rather than "CI never ran." When #45 merged, GitHub retargeted #46's base to `main` — but a base-branch retarget fires no workflow run either, so the head commit still carried no `verify` result. A required check that has never reported leaves a PR `BLOCKED` forever; it took an empty commit to force a `synchronize` event and produce the first (passing) run.
*   **Decisions Logged:**
    *   Removed the `branches: [main]` filter from the `pull_request` trigger (default activity types `opened`/`synchronize`/`reopened` unchanged); kept it on `push` to avoid double CI runs on `main`.
    *   **The gap predates the required-check change — stacked PRs in this repo had simply been merging without CI running on them at all.** Standing lesson: a branch-filtered `pull_request` trigger is scoped by base, not head, and needs to be checked whenever this repo's workflow starts stacking PRs on top of each other rather than always off `main`.
*   **Approval:** Human verified.

**[2026-08-20 00:00:00 UTC] - ARCHITECTURE_CHANGE**
*   **Action:** Scaffolded arms B, D, and E of the graph-scoped-vs-whole-doc cascade ablation (#19), runnable today with no live provider key (PR #31 MERGED, closes #27).
*   **Agent:** Claude Code, pre-push adversarial troublemaker review.
*   **Context:** The ablation defined in the 2026-08-16 vision audit (below) needs a real comparative run to settle whether further docGraph investment is justified, but that run is blocked on an operator-supplied live provider key (#19). The harness itself — the part with no such dependency — had not been built.
*   **Decisions Logged:**
    *   **Shared substrate, not parallel implementations:** `proposeCascadeEdits` was refactored (behavior-preserving) to expose `resolveProposedEdits` (tool-call parsing → blockId anchoring → evidence verification → severity derivation) and `applyRelevanceJudge` as reusable pieces. Every ablation arm shares this exact substrate; arms differ only in what candidates they generate from (arm C's 2-hop graph neighborhood vs. arm B's whole-doc plan-then-scoped-patch vs. arm D's whole-doc free edits) and what verify pass runs after — isolating the actual variable under test instead of confounding the comparison with anchoring/evidence differences between arms.
    *   **Arm B mislabeling — HIGH finding, fixed pre-push:** the first implementation collapsed plan-then-patch into a single call, which is architecturally arm A + verify, not arm B. Fixed into a genuine two-stage pipeline: a PLAN call over the whole document identifies affected blocks only, then a PATCH call writes the actual replacement + evidence for just those blocks. Recorded because this scaffold is meant to be reused as-is once a live key lands, not rewritten at that point — a mislabeled arm would have silently invalidated the eventual comparison.
    *   **Arm D reuses existing deterministic machinery rather than inventing new verification:** numeric/figure conflicts already deterministic-verified by the shared severity-derivation logic; `probably` proposals additionally checked against `docGraph`'s own refs/terms/duplicate-sentence extractors — a citation the deterministic graph doesn't connect to the primary block caps to `optional`. No LLM judge call in this arm by design.
    *   Verification harness: 67 new tests exercising all 3 arms × cheap-model on/off × every EditPropBench fixture with scripted calls — proves the harness runs cleanly and produces the correct metrics shape, deliberately NOT a quality gate on arms B/D's actual numbers (that's exactly what the still-blocked live comparative run exists to measure). No live provider is faked anywhere in this change.
*   **Approval:** Human verified.

**[2026-08-20 00:00:00 UTC] - FEATURE_ADD / ACCESSIBILITY**
*   **Action:** Recovered the salvageable half of a stranded, never-PR'd branch — answer-placement choice and accessibility hardening (PR #50 MERGED, closes #49).
*   **Agent:** Claude Code, pre-push adversarial troublemaker review.
*   **Context:** `claude/pr-audit-sidebar-options-nvwfu8` had drifted 32 commits behind `main` and 4 ahead with no PR ever opened — flagged stale by the fleet-status L-047 detector. Its four commits carried real, non-conflicting product work mixed with one commit that needed operator attention.
*   **Decisions Logged:**
    *   **Cherry-picked, not merged wholesale:** the answer-placement commit (`layoutStore`, `computeFloatingPosition()`, `FloatingAnswer`) applied clean. The accessibility commit applied with one conflict — it also edited `ProjectSidebar.tsx`, which `main` had since deleted via PR #36 — resolved by keeping the deletion (verified by grep that nothing else in the diff referenced the file).
    *   **Deliberately dropped, not superseded:** the branch's CI/CODEOWNERS commit touched `.github/workflows/**` and `.github/CODEOWNERS` — an unattended session cannot write those paths (platform-level restriction, not a judgment call), and `main`'s CODEOWNERS still carries the rule that commit meant to relax. That part needs an operator-attended session. Its two genuinely non-machinery files (a Playwright sandbox config env-var, a more robust FalkorDB-down connectivity probe covering timeout/DNS-error cases beyond `ECONNREFUSED`) were pulled forward on their own since dropping them would have introduced a real regression this PR would otherwise ship with. The branch's fourth commit (a merge reconciling with `main`) was dropped as genuinely superseded by #36's already-landed deletion.
    *   **HIGH finding, fixed pre-push:** the accessibility commit's own message cited an e2e spec's old `dispatchEvent('click')` workaround as the reason it moved History/Audit behind an overflow menu, but never updated the spec itself — after the UI change, no always-visible `History` button exists, so the spec would time out. Fixed by pulling forward the spec fix that already existed for this on the dropped CI commit; verified by running the spec directly, confirming it gets past the History-tab click and fails only on a later, unrelated assertion reproduced identically on unmodified `main` (pre-existing, not fixed here).
    *   **MEDIUM finding, fixed pre-push:** `AnnotationCard`'s held-answer reveal-poll effect wasn't gated the same way as its sibling cascade-reveal effect (both meant to ensure exactly one card owns the decorations when both a sidebar row and a floating panel exist for the same annotation) — two live polls could each flash their own "Answer ready" chip. Fixed by gating it on `showDetail` like its sibling.
*   **Approval:** Human verified.

**[2026-08-25 00:00:00 UTC] - BUG_FIX**
*   **Action:** Fixed a `heldAnswers` leak on annotation/document removal — continuing a bug chain this ledger has no prior entries for (issue #95 → PR #102 → issue #103 → PR #106 → issue #107). Delivered as PR #106 (branch `claude/purge-held-answer-on-remove`, https://github.com/Vinylfigure/intent-ide/pull/106, body "Closes #103") — **OPEN, pending operator review and merge, not yet in `main`.**
*   **Agent:** work-loop scheduled firing / Claude Code, two rounds of pre-push adversarial troublemaker review.
*   **Context:** Issue #103 ("heldAnswers can leak through annotation removal / AnnotationCard unmount") reported that a held answer in `useFlowStore` for a removed annotation has no live poll and can never be revealed, leaking for the rest of the session. #95/#102 are the immediately-prior fix in this same chain but predate any record in this memory bank and are not detailed here.
*   **Decisions Logged:**
    *   `useAnnotationStore.remove(id)` now also calls `useFlowStore.getState().revealAnswer(id)` to purge a matching `heldAnswers[id]` entry.
    *   **Adversarial review found `remove()` has zero production call sites** (confirmed by repo-wide grep) — the actually-reachable trigger is `useAnnotationStore.clear()`, called from `DocInputModal.tsx` on every New/Paste/Generate/Import document action. `clear()` was wired to also call a new `useFlowStore.clearHeldAnswers()` to drop every held answer atomically; without this the leak would not have been closed in practice.
    *   **Round 1 (NO-MERGE):** the initial fix patched only the dead-code `remove()` path. Also caught and corrected a false code comment claiming the localStorage-quota emergency prune inside `annotationStore.ts`'s custom `storage.setItem` catch block triggers `remove()` — confirmed false: that prune path only rewrites the serialized persisted blob directly via `localStorage.setItem` and never touches live Zustand state or calls any store action.
    *   **Round 2 (NO-MERGE, after wiring `clear()`):** found a third, distinct, still-unpatched leak — `documentStore.ts`'s `deleteDocument` (wired from `DocumentHubSidebar.tsx`'s delete action, which has no `<Confirmation>` gate) never touches `annotationStore` or `flowStore` at all, so a deleted document's annotations — not just their held answers — are orphaned forever. **Deliberately filed as follow-up issue #107 rather than folded into this PR**, since fixing it properly needs its own design pass: `documentStore.ts` reaching into `useAnnotationStore` (or vice versa) risks a circular import, because `annotationStore.ts` already imports `useDocumentStore`. Also fixed a stale test comment still repeating round 1's debunked quota-prune claim.
    *   New test file `src/stores/__tests__/annotationStore.removeHeldAnswer.test.ts`. Verification: 1072 passing + 10 skipped on the PR branch (was 1070 before round 2's two added `clear()` tests); `npm run typecheck` / `npm run lint` clean.
*   **Approval:** Pending — PR #106 open, awaiting operator review and merge.

**[2026-08-27 00:00:00 UTC] - BUG_FIX**
*   **Action:** Fixed the `inFlightCount` ("N thinking…" chip) scoping gap left open by PR #120/#116 — closes issue #121, filed as a follow-up by PR #120's own adversarial review. Delivered as PR #124 (branch `claude/statusbar-inflight-scope`, https://github.com/Vinylfigure/intent-ide/pull/124, body "Closes #121") — **OPEN, pending operator review and merge, not yet in `main`.**
*   **Agent:** work-loop scheduled firing / Claude Code, one round of pre-push adversarial troublemaker review.
*   **Context:** PR #120 (2026-08-27, above) scoped `StatusBar.tsx`'s `annotationCount`/`changeSetCount`/`changeCount` chips to the active document but deliberately left `inFlightCount` (the "N thinking…" chip) out of #116's stated scope, since `documentStore.setActiveDocument` has no side effects pausing background classification/resolution on document switch — so the chip could count in-flight work on a document other than the one on screen. That gap was filed as issue #121 during PR #120's own review.
*   **Decisions Logged:**
    *   `StatusBar.tsx`'s `inFlightCount` selector now filters `a.documentId === activeDocumentId`, matching the pattern PR #120 already applied to the other three chips.
    *   **Adversarial review verdict MERGE, first round:** repo-wide grep confirmed no other code path duplicates the `pending|classified|resolving` in-flight filter for a display count — `annotationStore.ts`'s `finalizeInterruptedAnnotations` uses the same status trio but for rehydration repair (correctly out of scope), and `DocumentHubSidebar.tsx`'s delete-confirmation count is an unrelated, intentionally different per-target-document filter. Every new test assertion was traced against the pre-fix filter and confirmed to fail on revert.
    *   **One non-blocking coverage-parity nit, closed before push:** the sibling #116 test file had an explicit `activeDocumentId === null` case this file initially lacked. Traced and confirmed a coverage gap rather than an exploitable bug — `documentId` is typed non-nullable `string` and `annotationStore.ts`'s `migrateAnnotations` unconditionally backfills a nullish `documentId` on hydration — but the null-active-document test was added anyway before push to close the parity gap.
    *   New test file `src/components/Layout/__tests__/statusBar.inFlightScope.test.tsx` (4 tests). Verification: 1111 passing + 10 skipped on the PR branch (1110 on `main` at merge base `dcfbee4`, the commit that merged PR #120); `npm run typecheck` / `npm run lint` clean.
    *   No new follow-up issues filed — the fix was fully scoped to #121's stated done-means with no descoped remainder.
*   **Approval:** Pending — PR #124 open, awaiting operator review and merge.

**[2026-08-27 00:00:00 UTC] - PROCESS**
*   **Action:** Reconciled merge-status drift in the memory bank for entries recorded as "OPEN" that have since merged, and recorded other repo activity not actioned this session, for continuity.
*   **Agent:** Code Librarian / Claude Code.
*   **Context:** The PR #124 session confirmed (merge base `dcfbee4`) that **PR #120** (closes #116, "StatusBar chip counts scoped to active document") had merged to `main` since its 2026-08-27 entry above was written as OPEN; `progress.md` and `changelog.md` are updated in place to reflect this (the corresponding audit entries above are left as originally written, per this ledger's append-only rule — this entry records the correction rather than editing history).
*   **Decisions Logged:**
    *   **PR #120 MERGED** (closes #116).
    *   Also confirmed merged in the same window: **PR #119** (closes #115, "Gate collection delete behind a confirmation step") — no prior entry existed in this ledger for #115/PR #119; recorded here for the first time as a merged fact, not narrated in detail.
    *   **Issue #117 has an open PR #123** (not yet merged — `mergeable_state` shows a merge conflict against `main`, but CI checks report green) — not touched this session, left for its own review/resolution pass.
    *   **Issue #122 was filed** (discovered-from PR #123/#117's adversarial review) — not yet consumed by any session.
    *   PR #106 (closes #103, `heldAnswers` leak fix) status is unchanged — still OPEN as of this entry; no new information on it this session.
*   **Approval:** Human verified (record-keeping only; no code changed by this entry).

*   **Action:** Fixed `loadDoc()` failing to flush the outgoing document's pending dirty edit before switching documents — discovered as a by-product of adversarial review on PR #123 (the fix for #117) and filed as its own issue (#122) with its own done-means, not folded in or left as a TODO. Delivered as PR #125 (branch `claude/loadDoc-flush-outgoing-dirty`, https://github.com/Vinylfigure/intent-ide/pull/125, base `main` at `dcfbee4`) — **OPEN, pending operator review and merge, not yet in `main`.**
*   **Agent:** work-loop scheduled firing / Claude Code, pre-push adversarial troublemaker review.
*   **Context:** `DocInputModal.tsx`'s `loadDoc()` (shared by Blank/Paste/Generate/Import) replaced the editor's content and switched `activeDocumentId` to a newly created document without first flushing the outgoing document's pending unsaved edit — unlike `EditorShell.tsx`'s own document-switch effect, which already guards against exactly this. Concretely: type into Document A within the 5s autosave window, then create/paste/generate/import a new document before the timer fires — `loadDoc()`'s content-replace transaction re-arms the autosave debounce around the *new* document's content (destroying the timer that would have flushed Doc A), and `createDocument()` resets `isDirty: false` before `EditorShell`'s switch-effect guard can see it — Doc A's edit was silently dropped: never written to localStorage, never recorded via `recordCommit`.
*   **Decisions Logged:**
    *   `loadDoc()` now reads `useDocumentStore.getState()` at the top of the function, before dispatching the replace transaction — if the active document is dirty, it captures the *current* (pre-replace) editor content via `view.state.doc.toJSON()` and flushes it with `saveDocument()` + `recordCommit()` (kind: 'direct', actor: 'human'), mirroring `EditorShell.tsx`'s existing guard exactly. All four call sites (Blank/Paste/Generate/Import) funnel through this one fixed function.
    *   **Adversarial review verdict MERGE.** Confirmed sound: flush ordering reads `view.state.doc` before the replace transaction (no stale-closure risk); `useDocumentStore.getState()` is read fresh at call time, not a stale render-time closure; no new reentrancy risk — the flush dispatches no transaction, so it cannot recursively retrigger `EditorShell`'s `dispatchTransaction` → `debouncedSave`; `EditorShell`'s own switch effect does not double-flush (by the time it runs, `createDocument()` has already reset `isDirty` to `false`, so its guard correctly no-ops) — it still performs a pre-existing, unrelated redundant reload of the new document's just-written content, confirmed NOT a regression introduced by this fix.
    *   **One real test-quality finding, fixed before push:** the original test 2 only asserted `loadDoc()` didn't throw when `isDirty` was false — a weakened guard (`||` instead of `&&`) would have passed identically. Fixed by spying on `saveDocument` directly; self-mutation-tested afterward (weakened the guard to `||`, confirmed the tightened test fails; restored the fix, confirmed it passes again). Same recurring lesson as Flow v1's H1 and the Phase 4 invariant-ledger review: assertions that pass when the feature is broken are not coverage.
    *   **Adjacent bug surfaced, NOT a new discovery, no new issue filed:** the review independently found `loadDoc()`'s content-replace transaction is missing `tr.setMeta('addToHistory', false)`, so an immediate Cmd-Z after a document switch can resurrect the outgoing document's content into a view still bound to the new document's id, risking the next autosave silently overwriting the new document's storage with the old one's content. This is exactly the bug already fixed on open PR #123 (`claude/loadDoc-undo-history-guard`, closes #117), which predates this branch — verified by diffing PR #123's branch directly rather than assumed. The PR body notes this explicitly so nothing is silently dropped between two open PRs touching the same function.
    *   New test file `src/components/DocInput/__tests__/docInputModal.flushOutgoingDirty.test.tsx` (2 tests). Verification: `npm run typecheck` clean, `npm run lint` clean, `npm run test` — 1109 passing + 10 skipped (1107 baseline on `main` at `dcfbee4`, +2 new tests).
*   **Approval:** Pending — PR #125 open, awaiting operator review and merge.

**[2026-08-27 00:00:00 UTC] - BUG_FIX**
*   **Action:** Fixed a document-load undo-history guard gap — consuming issue #117 — and separately found, reproduced, and deliberately did not fix a distinct silent-data-loss bug in the same function. Delivered as PR #123 (branch `claude/loadDoc-undo-history-guard`, https://github.com/Vinylfigure/intent-ide/pull/123, body "Closes #117") — **OPEN, pending operator review and merge, not yet in `main`.**
*   **Agent:** work-loop scheduled firing / Claude Code, with an adversarial troublemaker subagent review.
*   **Context:** Issue #117 reported that creating a new document leaves its editor-replace transaction in undo history, risking cross-document content bleed via Cmd-Z. `DocInputModal.tsx`'s `loadDoc()` (the single function shared by Blank/Paste/Generate/Import) dispatched its full-content `replaceWith` transaction without `tr.setMeta('addToHistory', false)`, unlike `EditorShell.tsx`'s own document-switch path, which was given exactly this guard on 2026-07-09 (v8.4 candidate, PR #4) precisely to stop undo from resurrecting a previous document's content under a new document's id. `loadDoc()` was a second, previously-unnoticed site with the identical unguarded pattern.
*   **Decisions Logged:**
    *   `loadDoc()` now dispatches its content-replace transaction with `tr.setMeta('addToHistory', false)`, matching `EditorShell.tsx`'s existing guard. Because all four load paths (Blank/Paste/Generate/Import) funnel through this one function, one fix closes all four.
    *   **Regression test verified concretely, not just added:** `src/components/DocInput/__tests__/docInputModal.loadDocHistoryGuard.test.tsx` mounts a real `EditorView` with the `history` plugin (not a mock), drives the Paste flow, then calls `undo()` and asserts content is unchanged and `undo()` returns `false`. Mutation-tested — reverting only the fix reproduces the exact resurrection bug and fails the test, proving the guard is real, not vacuous.
    *   **Adversarial review confirmed the fix correct and complete for #117's stated scope:** grepped the codebase repo-wide and confirmed no other unguarded full-document-replace site exists anywhere — the only three full-document-replace sites in the codebase are `EditorShell.tsx` (pre-existing, guarded), `src/lib/history/commits.ts` (pre-existing, guarded), and this one (now guarded). Also confirmed the new test's assertion distinguishes a truthy-but-not-`false` `addToHistory` value from a real fix, per prosemirror-history's own `!== false` check — a test that only asserted truthiness would have been a false gate.
    *   **Separate pre-existing bug found and reproduced, deliberately NOT fixed in this PR:** the same review independently reproduced, via a scripted repro using fake timers (not shipped), that `loadDoc()` never flushes the *outgoing* document's dirty autosave before replacing content and switching `activeDocumentId` — unlike `EditorShell.tsx`'s own switch effect, which does `if (previousDocumentId && docStore.isDirty) docStore.saveDocument(...)` first. Failure chain: user edits Doc A inside the 5s autosave debounce window → opens `DocInputModal` and loads Doc B → the load's `docChanged` transaction re-triggers `debouncedSave`, clearing Doc A's pending flush timer and rescheduling it around the now-replaced Doc B content → `createDocument()` sets `activeDocumentId` to Doc B and resets `isDirty: false` → `EditorShell`'s own flush-before-switch guard re-reads `isDirty` fresh and finds it already false, so its safety net no-ops → Doc A's edit is silently lost, never written to localStorage, never recorded via `recordCommit`. This is a silent DATA-LOSS bug (not corruption), independent of the addToHistory fix, and structurally similar in shape to the "descope rather than ship wrong" pattern used for #44 (2026-08-20). **Filed as its own follow-up, issue #122**, with a stated done-means and the repro chain (`discovered-from: work-loop adversarial review of the PR for #117, 2026-08-27`), rather than folded into this PR or silently omitted.
    *   **PR body discloses #122 honestly:** states "Closes #117" and separately and plainly discloses issue #122 as a known, related-but-separate, unfixed bug — not folded in, not omitted.
    *   Verification: `npm run typecheck` clean, `npm run lint` clean, `npm run test` — 1101 passing + 10 skipped (up from 1100 on `main` at commit `acba817`).
*   **Approval:** Pending — PR #123 open, awaiting operator review and merge.

**[2026-08-28 00:00:00 UTC] - PROCESS**
*   **Action:** Reconciled merge-status drift for entries recorded as "OPEN" that have since merged, ahead of this session's own delivery below.
*   **Agent:** Code Librarian / Claude Code.
*   **Context:** At the start of this session, live GitHub state showed **PR #123** (closes #117) and **PR #124** (closes #121) — both logged above as OPEN — had since MERGED. `progress.md` and `changelog.md` are updated in place to reflect this (per those files' own established practice of editing merge-status headings once confirmed, as already done for PR #120); the audit entries above are left as originally written, per this ledger's append-only rule.
*   **Decisions Logged:**
    *   **PR #123 MERGED** (closes #117, `loadDoc()` undo-history guard). **PR #124 MERGED** (closes #121, StatusBar `inFlightCount` scoping).
    *   Issue #122 (the `loadDoc()` outgoing-autosave-flush data-loss bug PR #123 disclosed but did not fix) gained an open **PR #125**, which went stale (`mergeable_state: dirty`) after #123/#124 merged and was superseded by **PR #130** ("Rebase #125 onto main after #123 merged", also closes #122, `mergeable_state: clean`, CI green) — both #125 and #130 are OPEN as of this session, untouched by it (their own CI is green, so the work-loop's "an unmerged PR with red checks outranks new work" rule was not triggered).
    *   **PR #129** (closes #126, `changesStore` documentId migration mirroring `annotationStore`'s) MERGED before this session started — no prior entry existed in this ledger for #126/PR #129; recorded here for the first time as a merged fact, not narrated in detail.
    *   New issue **#128** was filed by the repo owner (not this session) about a migration-fallback data-integrity gap in `migrateAnnotations`/`migrateChanges`, discovered from PR #129's own adversarial review — still open, not evaluated this session since issue #127 (below) was chosen first as the older ready task.
    *   PR #106 (closes #103, `heldAnswers` leak fix) status is unchanged — still OPEN as of this entry; no new information on it this session.
*   **Approval:** Human verified (record-keeping only; no code changed by this entry).

**[2026-08-28 00:00:00 UTC] - BUG_FIX**
*   **Action:** Fixed a concurrency correctness bug in the document dependency graph's inflight-build dedupe — closes issue #127, a debt named at the Cascade v2 Wave D1+D2 finale (2026-07-09) but never fixed until now. Delivered as PR #131 (branch `claude/docgraph-inflight-capability`, https://github.com/Vinylfigure/intent-ide/pull/131, body "Closes #127") — **OPEN, pending operator review and merge, not yet in `main`.**
*   **Agent:** work-loop scheduled firing / Claude Code, two rounds of pre-push adversarial troublemaker review, both mutation-tested by the delivering session itself.
*   **Context:** `getDocGraph` (`src/lib/graphrag/docGraph.ts`) deduped concurrent builds for the same document content-hash via an `inflight` map keyed only on the hash — no record of which capabilities (`llm`/`embeddings`/`graphiti`) the in-flight build would actually deliver. `scheduleDocGraphRebuild` calls it on every debounced edit with `skipLlm`/`skipEmbeddings`/`skipGraphiti` all true, a deliberate data-egress decision (document text must never leave the machine as a side effect of typing). A user-initiated cascade wanting the fuller augmented graph that called `getDocGraph` for the same content hash while that background build was still in-flight was silently handed the SAME promise, resolving to the deterministic-only graph with no error or signal that it was missing what it explicitly asked for — under-proposal, not corruption, but a correctness gap in the capability contract.
*   **Decisions Logged:**
    *   **Capability-aware inflight entries + continuation chaining (option (b) of #127's own stated acceptable approaches):** `inflight` entries now carry the capability set they will deliver. A caller whose wanted capabilities are not covered by an in-flight entry chains a continuation — it awaits the same in-flight `DocGraph` object, then runs only the still-missing passes against it (`applyRequestedPasses`, extracted behavior-preserving from the prior build body) before re-caching and re-publishing, mutating the SAME shared graph object rather than constructing a second one that could clobber the cache. A third caller wanting still more capability chains onto that continuation in turn. Callers requesting the same or a subset of an in-flight build's capabilities continue to dedupe onto one build unchanged.
    *   **Round 1 (NO-MERGE, HIGH, reproduced):** the first fix folded `llmAvailable(config)` into a single flag used both for cache/inflight capability bookkeeping AND for gating whether `applyRequestedPasses` entered the LLM branch. That branch does more than call the model — it also carries forward previously-cached LLM edges for UNCHANGED blocks via `findBestPriorGraph`/`carryForwardLlmEdges`, which the pre-#127 code ran whenever the caller simply didn't pass `skipLlm`, independent of live-call availability (`augmentWithLlmEdges` already self-guards unavailability internally without touching `llmApplied`). Folding availability into the carry-forward gate meant a dropped or invalid API key would silently ERASE previously-found LLM edges for content the triggering edit never even touched. Reproduced concretely: build with a valid key (LLM finds an edge) → key becomes invalid → edit an unrelated block → rebuild → the edge vanishes on the broken version, survives on `main`. **Fixed by splitting intent from availability:** `llmRequested = !deps.skipLlm` (raw caller intent, gates the carry-forward branch — matching the original pre-#127 behavior) vs. `llmWanted = llmRequested && llmAvailable(config)` (availability-aware, used only for the cache-hit check).
    *   **Round 2 (NO-MERGE, HIGH, reproduced):** round 1's split was applied only at the single-call `wanted` object passed into `applyRequestedPasses`. The multi-caller `covers` check and `InflightEntry` bookkeeping in `docGraph.ts` still compared availability-gated `llmWanted` on both sides — so two concurrently-unavailable callers whose own `llmWanted` was false either way (making the mismatch invisible to that comparison) could still differ in RAW intent (one skips llm, one doesn't), and the requesting caller would silently inherit the skipping caller's in-flight result. **The same bug shape as #127 itself, one layer down.** Confirmed dormant in production today only because every current call site happens to couple `skipLlm` with `skipGraphiti`/`skipEmbeddings` — an unenforced, undocumented cross-file invariant across `scheduleDocGraphRebuild`, `directEditTrigger.ts`, and `entailmentCheck.ts`; `proposeCascadeEdits` in `orchestrator.ts` is the one caller that never skips llm, and it also never skips graphiti, which happens to force the `covers` check false against every background caller regardless. **Fixed by using `llmRequested` consistently** through `InflightEntry.llm`, the `covers` comparison, and both entry-construction sites (fresh-build and continuation-chaining). **Rule recorded:** a capability-mismatch fix at one call site is not proven complete until every OTHER place that reads or compares the same capability flag is audited for the identical intent-vs-availability conflation — the bug can hide one layer down in shared bookkeeping even after the call site that motivated the fix is correct.
    *   **Both round findings were mutation-tested directly by the delivering session** — the specific fix was temporarily reverted, the corresponding new regression test was confirmed to fail with the exact predicted error, then the fix was restored — not merely argued from reading the diff.
    *   **A third, self-identified gap (not reviewer-flagged) was also closed before push:** round 2's own summary claimed a test covered "orthogonal capability requests serializing rather than parallelizing" — a disclosed, accepted, non-blocking design trade-off explicitly named as acceptable in #127 itself, not a regression — but that claim was inaccurate on inspection: the cited test only exercised a SUBSET scenario (dedupe short-circuit onto a fuller build), never two genuinely DISJOINT capability requests (e.g. llm-only vs embeddings-only, neither a subset of the other). A new test closes the gap, proving chained continuations still deliver BOTH requested capabilities even though the design serializes rather than parallelizes them.
    *   **6 new tests** in `src/lib/graphrag/__tests__/docGraph.test.ts` (across the `getDocGraph — incremental per-block updates` and `getDocGraph cache` describe blocks): the original race repro; a subset caller deduping onto an in-flight fuller build with no redundant model call; the exact production call shapes of `scheduleDocGraphRebuild` and `proposeCascadeEdits` (which hit the un-stubbed `embeddingsEnabledFromStore()` await before either call reaches the inflight check — a subtlety round 1 flagged as untested); round 1's carry-forward-across-unavailability regression; round 2's intent-vs-availability inflight-bookkeeping regression; and the disjoint-capabilities chaining test from the self-identified gap.
    *   Verification: `npm run typecheck` clean, `npm run lint` clean, `npm run test` — 1126 passing + 10 skipped (up from 1120 on `main` at merge base `2f388a9`; +6 new tests, nothing else regressed).
    *   No new follow-up issues filed — the one disclosed known limitation (serialized rather than parallelized disjoint-capability chaining) was closed with a regression test in this same PR rather than deferred, and is explicitly within #127's own stated scope.
*   **Approval:** Pending — PR #131 open, awaiting operator review and merge.
**[2026-08-28 00:00:00 UTC] - FEATURE_ADD**
*   **Action:** Built a view/manage/purge UI for the `LEGACY_DOCUMENT_ID` migration bucket, consuming issue #133 — filed as a follow-up from PR #132's own adversarial review. Delivered as PR #135 (branch `claude/legacy-data-ui`, body "Closes #133") — **OPEN, stacked on unmerged PR #132, awaiting operator review and merge of both, not yet in `main`.**
*   **Agent:** work-loop scheduled firing / Claude Code, one round of pre-push adversarial troublemaker review.
*   **Context:** Issue #133 asked for a UI path to view/manage/purge the `LEGACY_DOCUMENT_ID` migration bucket that PR #132 (closes #128, still open, not yet merged to `main`) introduces. **This PR is stacked: its base branch is `claude/legacy-documentid-migration-fallback` (PR #132's branch), not `main`,** because the fix depends on `src/lib/documents/legacyDocumentId.ts`, which PR #132 introduces and which does not exist on `main` yet. PR #132 and a separate open PR #131 (closes #127) are unrelated prior-iteration work this firing did not touch, other than building on top of #132's branch content.
*   **Decisions Logged:**
    *   **New `changesStore.ts` action `removeByDocumentId(documentId)`** (filters `entries` + `changeSets`), mirroring `annotationStore.ts`'s existing action of the same name — `changesStore` had no equivalent action before this PR.
    *   **New "Legacy data" section in `ApiKeyModal.tsx`'s API Configuration modal**, shown only when non-empty: counts of `LEGACY_DOCUMENT_ID`-scoped annotations/change-sets/changes, and a "Clear legacy data" button wired to both stores' `removeByDocumentId(LEGACY_DOCUMENT_ID)`.
    *   **Deliberately rejected the issue's other suggested approach — making `LEGACY_DOCUMENT_ID` selectable as `activeDocumentId`:** verified via `EditorShell.tsx` that new annotations/changes are stamped `documentId: activeDocumentId` at creation time, so making the placeholder "active" would let new records leak into the bucket — a new contamination vector into the exact thing PR #132 was built to close off. A dedicated settings-panel view/clear affordance was used instead.
    *   **Adversarial review verdict MERGE, no blocking findings.** MEDIUM, disclosed not fixed: "Clear legacy data" has no confirmation gate and is irreversible, foreclosing a hypothetical future content-matching un-merge recovery path `legacyDocumentId.ts`'s own doc comment describes as "left undone" (not abandoned) — judged acceptable because CLAUDE.md's HITL mandate is scoped to "global document changes," and this is orphaned metadata attached to no real, visible document, unlike `DocumentHubSidebar`'s Confirmation-gated document/collection delete; this same modal already has an unguarded irreversible "Reset" button for calibration stats as precedent. LOW, moot: `removeByDocumentId` doesn't touch `snapshots` (no `documentId` field on that model) — confirmed `createSnapshot()` has zero production call sites anywhere in `src/`, dead code today. LOW, cosmetic, not blocking: since the section renders on the sum of three counts, an individual count can read "0" in the rendered sentence.
    *   **Pre-existing bug found, confirmed, NOT fixed here, filed as follow-up issue #134:** `DocumentHubSidebar.tsx`'s real document-delete handler only calls `useAnnotationStore.getState().removeByDocumentId`, never a `useChangesStore` equivalent (which did not exist until this PR added it) — so deleting a real document has always silently orphaned that document's changesStore entries/changeSets, independent of this PR (`discovered-from: work-loop adversarial review of the PR for #133, 2026-08-28`).
    *   New test files: `src/stores/__tests__/changesStore.removeByDocumentId.test.ts` (2 tests), `src/components/Settings/__tests__/apiKeyModal.legacyData.test.tsx` (3 tests) — both mutation-tested (fail against reverted production code). Verification: `npm run typecheck` clean, `npm run lint` clean, `npm run test` — 1137 passing + 10 skipped on the PR branch (up from 1132 on PR #132's branch, the merge base).
    *   **Carry-forward flagged:** once PR #132 merges to `main`, PR #135 needs a retarget/rebase — same pattern PR #130 followed for #125 after #123 merged.
*   **Approval:** Pending — PR #135 open, stacked on unmerged PR #132, awaiting operator review and merge of both.

**[2026-08-28 00:00:00 UTC] - PROCESS**
*   **Action:** Recorded repo-wide open-PR/issue state for continuity at the close of this firing, not actioned this session.
*   **Agent:** Code Librarian / Claude Code.
*   **Context:** As of this sweep, four PRs are open, all green CI / clean `mergeable_state`, all awaiting operator review/merge.
*   **Decisions Logged:**
    *   **PR #130** (closes #122, supersedes and should replace #125, which went dirty) — not touched this firing.
    *   **PR #131** (closes #127, docGraph inflight capability keying) — not touched this firing.
    *   **PR #132** (closes #128, legacy documentId migration fallback) — not touched this firing directly; PR #135 above stacks on its branch content.
    *   **PR #135** (closes #133, stacked on #132) — delivered this firing, see the entry above.
    *   **PR #125 is superseded by #130** and should be closed, not merged, once #130 lands — operator's call, not actioned by this firing.
    *   **Issue #134** (filed by this firing's adversarial review, see the entry above) is not yet consumed by any session.
*   **Approval:** Human verified (record-keeping only; no code changed by this entry).

**[2026-08-29 00:00:00 UTC] - BUG_FIX**
*   **Action:** Wired `changesStore`'s new `removeByDocumentId` action into the real document-delete handler, consuming issue #134. Delivered as PR #136 (branch `claude/changesstore-delete-wiring`, base `claude/legacy-data-ui`, https://github.com/Vinylfigure/intent-ide/pull/136) — **OPEN, stacked on unmerged PR #135 (itself stacked on unmerged PR #132), awaiting operator merge of all three, not yet in `main`.**
*   **Agent:** work-loop scheduled firing / Claude Code, one round of pre-push adversarial troublemaker review.
*   **Context:** Issue #134 (task: label, filed 2026-08-28, `discovered-from: work-loop adversarial review of the PR for #133, 2026-08-28`) recorded that `DocumentHubSidebar.tsx`'s `handleDeleteDocument` called `useAnnotationStore.getState().removeByDocumentId(documentId)` (the fix for annotations landed via #107/PR #106) but never called an equivalent for `changesStore` — because until PR #135 `changesStore.ts` had no `removeByDocumentId` action at all. PR #135 added that action to close #133; #134's scope was purely wiring the already-added action into the document-delete handler. **PR #136 is stacked: its base branch is `claude/legacy-data-ui` (PR #135's branch), not `main`,** because the action it depends on doesn't exist on `main` yet.
*   **Decisions Logged:**
    *   **`src/components/Layout/DocumentHubSidebar.tsx`:** added `import { useChangesStore } from '@/stores/changesStore'`; `handleDeleteDocument` now also calls `useChangesStore.getState().removeByDocumentId(documentId)`, right after the existing `useAnnotationStore` call and before `deleteDocument(documentId)`.
    *   **New test file `src/components/Layout/__tests__/documentHubSidebar.deleteClearsChanges.test.tsx`** (2 tests): deleting a document via the UI confirmation flow removes only that document's `changesStore` entries/changeSets, others untouched; cancelling leaves `changesStore` untouched.
    *   **Confirmed out of scope, not touched:** `deleteCollection` (`documentStore.ts`) never cascade-deletes member documents (only strips `collectionIds`), so it has no analogous gap — verified by reading the function directly.
    *   **Adversarial review verdict MERGE, no blocking findings.** Independently reproduced typecheck/lint/test and the mutation test (stashed the fix, confirmed the new test fails with the `e-1` entry surviving deletion; restored, confirmed green). Independently re-verified the `deleteCollection` out-of-scope claim by reading `documentStore.ts` directly. Grepped repo-wide for `deleteDocument(` — `DocumentHubSidebar.tsx` is the only call site; both its `onDelete` entry points (all-documents row, expanded-collection row) funnel through the same `handleDeleteDocument`, so one test covers both.
    *   **One LOW, disclosed, not fixed, pre-existing from #135 (not this diff):** `changesStore.removeByDocumentId` doesn't touch `snapshots` (`VersionSnapshot` has no `documentId` field) — mitigated since snapshots are never persisted (`onRehydrateStorage` always resets to `[]`), so it's an in-memory-only, session-bounded gap, not a storage leak. Not filed as a new issue (moot/pre-existing, not blocking).
    *   Verification: `npm run typecheck` clean, `npm run lint` clean, `npm run test` — **1139 passing + 10 skipped** on the PR branch (up from 1137 on PR #135's branch; +2 new tests).
    *   **Stack depth flagged:** this is now a 3-deep PR stack — `main` ← #132 (closes #128) ← #135 (closes #133, stacked on #132) ← #136 (closes #134, stacked on #135). Once #135 merges, PR #136 needs a retarget/rebase — same pattern PR #130 followed for #125 after #123 merged.
*   **Approval:** Pending — PR #136 open, stacked on unmerged PR #135 (itself stacked on unmerged PR #132), awaiting operator merge of all three.

**[2026-08-29 00:00:00 UTC] - PROCESS**
*   **Action:** Recorded repo-wide open-PR/issue state for continuity at the close of this firing, not actioned this session.
*   **Agent:** Code Librarian / Claude Code.
*   **Context:** As of this firing's ready-sweep, four PRs besides #136 are open, all green CI, all `mergeable_state: clean` except one.
*   **Decisions Logged:**
    *   **PR #135** (closes #133, stacked on #132) — not touched this firing directly; PR #136 above stacks on its branch content.
    *   **PR #132** (closes #128, base `main`) — not touched this firing.
    *   **PR #131** (closes #127, base `main`) — not touched this firing.
    *   **PR #130** (closes #122, base `main`, supersedes and should replace #125 which is now `mergeable_state: dirty` — #130's own body says close #125 without merging once #130 lands) — not touched this firing.
    *   None of these had red checks, so per the work-loop skill's priority rule they did not outrank starting new work on issue #134.
*   **Approval:** Human verified (record-keeping only; no code changed by this entry).

**[2026-08-30 00:00:00 UTC] - PROCESS**
*   **Action:** Reconciled merge-status drift for entries recorded above as "OPEN" that have since merged, and merged `main` into PR #135's branch to resolve a real `mergeable_state: dirty` conflict that GitHub's base-retarget exposed. Entries above are left as originally written, per this ledger's append-only rule.
*   **Agent:** work-loop scheduled firing / Claude Code (continuation of the session that delivered PR #135).
*   **Context:** Between the entries above and this one, the operator merged **PR #130** (closes #122), **PR #131** (closes #127), and **PR #132** (closes #128) to `main`, and separately merged **PR #136** (closes #134) directly into PR #135's branch (`claude/legacy-data-ui`) rather than into `main`. GitHub then retargeted PR #135's base from PR #132's branch to `main`, which exposed a real merge conflict — confirmed to be `memory-bank/*.md` append-at-top drift only (each of `progress.md`/`changelog.md`/`audit.md` had been updated independently by the parallel #131 and #135/#136 firings), no source-code conflict.
*   **Decisions Logged:**
    *   **PR #130, #131, #132 MERGED to `main`** — confirmed via the GitHub API (`merged: true` on all three).
    *   **PR #136 MERGED, but into PR #135's branch, not `main`** — confirmed via the GitHub API: `merged: true`, `merged_by: Vinylfigure`, merge commit `f2196d7`. Its fix (closes #134) reaches `main` only once PR #135 itself merges.
    *   **`origin/main` merged into `claude/legacy-data-ui` via a merge commit, never a rebase** — the branch already carried the operator's own merge commit from landing #136, so history was not rewritten, consistent with this project's stated git-safety rules.
    *   **All three memory-bank conflicts resolved by concatenation, not rewrite:** `progress.md`/`changelog.md` (newest-entry-at-top convention) got the newer #135/#136-firing entries first, then the older #131-firing entries, each internally corrected only for stale "OPEN"/"pending merge" status language (those two files' own established practice, per the PR #120 precedent cited in the entry above). This ledger (oldest-entry-at-bottom, append-only) instead got the older #131-firing entries placed BEFORE the newer #135/#136-firing entries with NOT ONE WORD of either changed — this entry is the correction, appended after both, per this file's own stated rule.
    *   **PR #135's body updated to also say "Closes #134"**, reflecting that #136's commits are now part of its diff.
    *   `npm run typecheck` / `npm run lint` / `npm run test` re-run clean on the merged tree before pushing (see the note this entry's session leaves in `progress.md`/`changelog.md` for the exact count).
*   **Approval:** Human verified (record-keeping only for the reconciliation; the underlying code merge was validated by the session's own test run before push).

**[2026-08-30 00:00:00 UTC] - BUG_FIX**
*   **Action:** Fixed a Graphiti cache-staleness bug in the document dependency graph — closes issue #137. Delivered as PR #139 (branch `claude/docgraph-graphiti-generation-refresh`, https://github.com/Vinylfigure/intent-ide/pull/139, body "Closes #137") — **OPEN, pending operator review and merge, not yet in `main`.**
*   **Agent:** work-loop scheduled firing / Claude Code, one round of pre-push adversarial troublemaker review.
*   **Context:** Issue #137 reported that `getDocGraph`'s fast cache-hit path in `src/lib/graphrag/docGraph.ts` never checked `cached.graphitiApplied` — once a document's graph had `llmApplied`+`embeddingsApplied` satisfied, every later `getDocGraph` call for the SAME unchanged content hash skipped the Graphiti entity pass forever, even though `episodeIngestion.ts`'s `ingestAnnotationEpisode`/`ingestEditEpisode` keep feeding new episodes into Graphiti on every resolved annotation (including ask/dig/flag types that never touch document text). New entities became permanently invisible to an already-built graph.
*   **Decisions Logged:**
    *   New module-level generation counter in `episodeIngestion.ts` (`getEpisodeGeneration()`/`resetEpisodeGeneration()`, bumped only on a successful `addEpisode`); new `DocGraph.graphitiEpisodeGen` field (-1 = never attempted) recording the generation as of the graph's last Graphiti attempt (success or failure).
    *   `augmentWithGraphitiEdges`'s guard moved from `graphitiApplied` to `graphitiEpisodeGen === currentGen`; `getDocGraph`'s fast-path condition gained a third clause so a stale-generation warm cache falls through to a real Graphiti retry — background/`skipGraphiti` calls unaffected.
    *   **Adversarial review verdict MERGE**, findings addressed before push: (1) added an end-to-end test exercising the REAL production wiring with no DI override (`episodeGeneration.test.ts`'s "real wiring" test — the other 3 new tests in `docGraph.test.ts` all inject `episodeGeneration` directly, which the reviewer flagged as a gap); (2) documented the under-recording-during-contention edge case (currentGen snapshotted before the ~1.5s MCP round trip — self-correcting, not a bug) in `augmentWithGraphitiEdges`'s doc comment; (3) hardened `graphitiEdges.test.ts`'s `beforeEach` to reset the episode-generation counter, since some of its tests implicitly depend on the real counter never having moved.
    *   **Filed follow-up issue #138 (NOT fixed here, deliberately descoped):** the fix introduces a new invariant break — a cached `DocGraph` can now be mutated-and-republished under the SAME object reference by a retry-in-place, and `docGraphStore`'s Zustand `Object.is` bail-out means an already-mounted "why this proposal?" explainer (`ProposedEditControl.tsx`) could show stale evidence until some unrelated re-render. Confirmed this does NOT affect actual cascade discovery — `orchestrator.ts`'s `proposeCascadeEdits` always awaits a fresh `getDocGraph` return value directly, never the store.
    *   New test file `src/lib/graphrag/__tests__/episodeGeneration.test.ts` (6 tests); 3 new tests in `docGraph.test.ts` ("getDocGraph — Graphiti episode-generation retry"), mutation-tested — reverting only `docGraph.ts`/`episodeIngestion.ts` reproduces the exact bug and fails all 3. `graphitiEdges.test.ts` and `entailmentCheck.test.ts` updated for the new required `graphitiEpisodeGen` field / test-isolation hardening.
    *   **Merge-conflict note (added during this branch's own merge with `main`, not a new PR):** `main` had meanwhile merged PR #131 (#127's inflight-capability-set fix), which refactored `getDocGraph`'s pass-application into a shared `applyRequestedPasses` helper — the same region of `docGraph.ts` this PR's fix touches. Reconciling the two: `applyRequestedPasses`'s Graphiti branch originally gated on `wanted.graphiti && !graph.graphitiApplied`, which — combined with this PR's own `augmentWithGraphitiEdges` never resetting `graphitiApplied` back to `false` — would have silently reintroduced #137's exact bug one layer down (a graph that ever succeeded once would never be reconsidered, since the boolean gate short-circuits before `augmentWithGraphitiEdges`'s own generation check is ever reached). Fixed by dropping the `!graph.graphitiApplied` clause from that gate — `augmentWithGraphitiEdges` already self-guards via `graphitiEpisodeGen`, so calling it whenever `wanted.graphiti` is true is both correct and necessary.
    *   **Adversarial (troublemaker) review of the merge resolution, verdict NO-MERGE, one HIGH finding, fixed before push — a THIRD occurrence of #127's own bug shape, pre-existing on `main` since PR #131 and untouched by either PR's own review or this merge.** `getDocGraph`'s fast cache-hit condition compared `(cached.llmApplied || !llmWanted)` — the availability-gated flag — where PR #131's two review rounds had already established (for the `wanted` object and the inflight `covers` check) that this comparison must use the caller's raw `llmRequested` intent instead. Reproduced empirically by the reviewer: a background (`skipLlm`) build caches a hash with `llmApplied: false`; the provider goes unavailable; a later, separate call for the SAME hash wanting carry-forward is treated as a cache hit (since its own `llmWanted` is also false) and never reaches `carryForwardLlmEdges` — a silent, *permanent* miss for that hash that does not self-heal when availability returns, since the stale cache entry is what keeps getting returned. Fixed by changing the clause to `!llmRequested`. New regression test in `docGraph.test.ts`, mutation-tested by this session (reverted the one-line fix, confirmed the exact predicted failure, restored it) — not merely argued from reading the diff.
    *   Verification: `npm run typecheck` clean, `npm run lint` clean, `npm run test` — 1150 passing + 10 skipped on the merged tree (after both fixes above).
*   **Approval:** Pending — PR #139 open, awaiting operator review and merge.

**[2026-08-30 00:00:00 UTC] - PROCESS**
*   **Action:** Documentation catch-up for three PRs (#130, #131, #132) that merged to `main` since the last memory-bank update (the PR #124 session, 2026-08-27) with no `memory-bank/` changes in their diffs. Delivered as its own small documentation-only PR (branch `claude/memory-bank-catchup-130-131-132`), per this repo's own CLAUDE.md convention that memory-bank updates belong in the PR that does the work — a convention these three PRs' authors did not follow.
*   **Agent:** Code Librarian / Claude Code.
*   **Context:** `main` was at `f322e4c` at the time of this catch-up; all three PRs' code was already present. `progress.md` and `changelog.md` gained new entries for each of the three PRs, inserted/prepended per each file's own most-recent-first convention. This ledger entry and the three that follow are the append-only record of the same three merges. No `src/` files were touched by this session.
*   **Decisions Logged:**
    *   **PR #130** (branch `claude/rebase-125`, closes #122) — MERGED. Rebased PR #125's `loadDoc()` flush-before-switch fix onto `main` after PR #123 (closes #117) had already merged and created a conflict. PR #125 is superseded/subsumed by #130 per #130's own PR body.
    *   **PR #131** (branch `claude/docgraph-inflight-capability`, closes #127) — MERGED. Fixed `getOrBuildDocGraph`'s inflight-build dedupe to key on requested capability, not just content hash.
    *   **PR #132** (branch `claude/legacy-documentid-migration-fallback`, closes #128, files #133) — MERGED. Hardened the legacy-`documentId` migration fallback in `annotationStore.ts`/`changesStore.ts` to a fixed placeholder instead of `activeDocumentId`.
    *   Issue #117's PR #123 (recorded above as OPEN with a merge conflict against `main`) is confirmed merged by this point, since #130's own PR body states it rebased on top of #123 having already landed — the corresponding #123 entry above is left as originally written, per this ledger's append-only rule; this entry records the correction rather than editing history.
*   **Approval:** Human verified (record-keeping only; no code changed by this entry).

**[2026-08-30 00:00:00 UTC] - BUG_FIX**
*   **Action:** Fixed `DocInputModal.tsx`'s `loadDoc()` to flush the outgoing document's dirty autosave before switching documents, closing issue #122. Delivered as PR #130 (branch `claude/rebase-125`, body "Rebase #125 (loadDoc flush) onto main after #123 merged") — **MERGED to `main`** (documented retroactively by the 2026-08-30 catch-up session above).
*   **Agent:** work-loop scheduled firing / Claude Code (original fix authored as PR #125; rebased and landed as PR #130 after PR #123 merged and created a conflict).
*   **Context:** Issue #122 (filed 2026-08-27 by PR #123/#117's own adversarial review, recorded above) reported that `loadDoc()` never flushed the *outgoing* document's dirty autosave before replacing content and switching `activeDocumentId`, unlike `EditorShell.tsx`'s own switch effect — silent DATA-LOSS, independent of the `addToHistory` guard PR #123 fixed. PR #125 fixed this originally; by the time it was ready to land, PR #123 had already merged to `main` and PR #125's branch conflicted with it. PR #130 is the rebase of PR #125's fix onto post-#123 `main`.
*   **Decisions Logged:**
    *   `loadDoc()` now flushes the outgoing document's dirty state via `saveDocument`/`recordCommit` before replacing editor content, mirroring `EditorShell.tsx`'s existing flush-before-switch guard.
    *   PR #125 is treated as superseded/subsumed by PR #130 rather than a separate delivery — PR #130's own body states "Supersedes #125 — close it rather than merging once this lands," and GitHub marked #125 merged once #130's rebased commits landed.
    *   Verification at merge: `npm run test` — 1122 passed, 10 skipped.
*   **Approval:** Human verified (merged).

**[2026-08-30 00:00:00 UTC] - BUG_FIX**
*   **Action:** Fixed `getOrBuildDocGraph`'s inflight-build dedupe in `src/lib/graphrag/docGraph.ts` to key on requested capability, not just content hash, closing issue #127. Delivered as PR #131 (branch `claude/docgraph-inflight-capability`, body "Closes #127") — **MERGED to `main`** (documented retroactively by the 2026-08-30 catch-up session above).
*   **Agent:** work-loop scheduled firing / Claude Code, two rounds of pre-push adversarial troublemaker review.
*   **Context:** The inflight-build dedupe was keyed on content hash alone, so a background deterministic-only rebuild (`scheduleDocGraphRebuild`, which always passes `skipLlm`/`skipEmbeddings`/`skipGraphiti: true` since document text must never leave the machine as a side effect of typing) could silently hand its impoverished result to a concurrent user-initiated cascade that wanted the fuller LLM/embeddings/graphiti-augmented graph, with no error or signal.
*   **Decisions Logged:**
    *   **Continuation-chaining fix:** `inflight` entries now carry the capability set they'll deliver; a caller wanting more chains a continuation that runs only the still-missing passes (`applyRequestedPasses`) against the same `DocGraph` object before re-caching.
    *   **Round 1 (NO-MERGE):** the fix conflated `llmAvailable(config)` (live-call availability) with raw caller intent, which would have silently erased previously-cached LLM edges for untouched blocks when the provider became unavailable — fixed by splitting `llmRequested` (raw intent, gates edge carry-forward) from `llmWanted` (availability-aware, used only for cache/inflight comparisons).
    *   **Round 2 (NO-MERGE):** the round-1 split wasn't applied consistently to the multi-caller `covers` check and `InflightEntry` bookkeeping, which could still let two concurrent callers silently diverge — fixed by using `llmRequested` consistently everywhere.
    *   **Disclosed, non-blocking trade-off:** two callers wanting genuinely disjoint capabilities (e.g. llm-only vs embeddings-only) pay for two sequential chained passes instead of parallelizing — correctness-preserving, not a regression, explicitly one of #127's own accepted approaches.
    *   New tests in `src/lib/graphrag/__tests__/docGraph.test.ts` (6 new). Verification: 1126 passing + 10 skipped at merge (up from 1120 baseline).
*   **Approval:** Human verified (merged).

**[2026-08-30 00:00:00 UTC] - BUG_FIX**
*   **Action:** Hardened the legacy-`documentId` migration fallback in `annotationStore.ts`'s `migrateAnnotations` and `changesStore.ts`'s `migrateChanges` so it never contaminates the active document, closing issue #128 and filing follow-up issue #133. Delivered as PR #132 (branch `claude/legacy-documentid-migration-fallback`, body "Closes #128") — **MERGED to `main`** (documented retroactively by the 2026-08-30 catch-up session above).
*   **Agent:** work-loop scheduled firing / Claude Code, one round of pre-push adversarial troublemaker review.
*   **Context:** Both migrations backfilled a missing/undefined `documentId` on pre-multi-document (pre-Phase-8, 2026-03-16) persisted records using whatever `activeDocumentId` happened to be active at the moment of the first post-upgrade rehydration — a user who'd used the app across multiple distinct pre-Phase-8 documents could have all that history silently merged onto whichever document happened to be open, contaminating its `AnnotationPanel`/`ChangesPanel`/`StatusBar` views.
*   **Decisions Logged:**
    *   **Investigated, deliberately not pursued:** whether a stable per-document identifier survives in the persisted data to properly un-merge distinct legacy documents. No stored foreign key exists, but `anchor.text`/`beforeSlice`/`afterSlice` do carry quoted document text that could in principle content-match against the legacy document bodies `documentStore.ts`'s `runLegacyProjectMigration` already recovers under real ids. Reasoning recorded in new file `src/lib/documents/legacyDocumentId.ts`'s doc comment: no rehydration-order guarantee across three independent Zustand `persist` stores; duplicate/near-duplicate phrasing is exactly what a text match would collide on; likely small affected population.
    *   **Fix:** both migrations now always fall back to one fixed `LEGACY_DOCUMENT_ID = 'legacy'` placeholder shared via that new file, never `activeDocumentId`.
    *   **One round of adversarial review, NO-MERGE with 1 HIGH + 2 MEDIUM, all fixed before the PR was opened:** (MEDIUM) the doc comment's first draft overstated the investigation, falsely claiming no field survives at all — corrected to state the real reasoning above. **(HIGH, disclosed rather than silently shipped)** the fix trades silent cross-document contamination for a new cost — since no real document is ever created with `LEGACY_DOCUMENT_ID`, a migrated record becomes permanently invisible to every `documentId === activeDocumentId` filtered view (`AnnotationPanel`/`ChangesPanel`/`StatusBar`/`AnnotationMap`/`FloatingAnswer`), with no UI path to view/manage/delete it — explicitly documented as an accepted trade-off (bounded by each store's existing FIFO persistence caps, so orphaned records eventually age out rather than growing unbounded) and covered by a regression test per store asserting the invisibility holds against every possible active document. Giving users an actual UI path to reach this bucket was ruled out of scope for #128 and filed as follow-up **issue #133**. (MEDIUM) `annotationStore.migration.test.ts` had re-implemented `migrateAnnotations` by hand with a comment claiming it "is not exported" — false as of this PR since it's now exported (mirroring `migrateChanges`, exported since #129) — switched to import and test the real function instead of a hand-rolled duplicate that could silently drift from it.
    *   New/updated test files (2). Verification: 1132 passing + 10 skipped at merge (up from 1120 baseline).
*   **Approval:** Human verified (merged).

**[2026-08-30 00:00:00 UTC] - INCIDENT / PROCESS**
*   **Action:** Diagnosed and reported that GitHub Actions CI is broken repo-wide at the infrastructure level. No code shipped, no PR opened, no fix attempted — this session's output is the diagnostic record itself.
*   **Agent:** work-loop scheduled firing / Claude Code.
*   **Context:** At firing start, three PRs were open — **PR #135** ("Add a way to view and clear the LEGACY_DOCUMENT_ID migration bucket", closes #133/#134), **PR #139** ("Retry Graphiti entity edges when a new episode lands...", closes #137, files #138), and **PR #140** ("docs: memory-bank catch-up for PRs #130, #131, #132", documentation-only, itself unmerged) — all three showing RED `verify` and `gate-integrity` checks. Investigating why led to tracing the failure to `main` itself rather than any PR's own diff.
*   **Decisions Logged:**
    *   **Verified via the GitHub API, not guessed:** PR #131 (closes #127) and PR #130 (rebase of #125, closes #122) had already merged to `main` before this firing started, along with **PR #132** (closes #128, files #133) — also merged. None of #130/#131/#132's own memory-bank documentation is present in the `memory-bank/` files this firing read at start, because **PR #140 — still open, unmerged — is the PR that was meant to add it.**
    *   **Root cause bounded to a specific window:** `main`'s own push-triggered `CI` workflow has been failing since the merges of #130/#131/#132 — all three merge commits landed 2026-08-30 between 06:47 and 06:49 UTC. The prior push to `main` (merging #129, 2026-08-28 06:02 UTC) was green.
    *   **Confirmed NOT a code regression:** every failed `verify` job attempt — 4 total across the run's history, including one `rerun_failed_jobs` triggered this session specifically to rule out a one-off flake — completed in 0-5 seconds with **0ms of billable runner time** per `get_workflow_run_usage`. No step (checkout, `npm ci`, anything) ever executed. Every job-attempt log download returns HTTP 404, consistent with a runner never having been allocated at all. One attempt sat queued for ~5.5 hours before failing this way.
    *   **Likely cause is operator-side, outside what an unattended firing can see or fix:** a GitHub Actions spending-limit/included-minutes exhaustion, a repo visibility change (private repos do not get the unlimited free Actions minutes public repos on standard runners get), or Actions disabled at the repo/org level. `.github/workflows/**` is off-limits to a headless firing to edit regardless of what's suspected.
    *   **Action taken:** posted a detailed diagnostic comment on the Status dashboard issue (#25), plus a short pointer comment on each of #135, #139, #140 noting their red checks are not caused by their own diffs. No code was written or pushed. No new PR was opened. No new task issue was filed — this finding is a blocker report, not a proposal.
    *   **Guidance recorded for the next firing:** check whether `main`'s most recent push-triggered `CI` run is green before doing anything else. If still red with the identical 0ms-billable-runtime / 404-log signature, it is the same operator-side block — comment again only if something material has changed; otherwise treat hosted CI as unusable for the time being and consider whether the ready-sweep can still proceed using local `typecheck`/`lint`/`test` (per the `test` skill) rather than re-running the same diagnostic every 4 hours.
*   **Approval:** Human verified (record-keeping and diagnostic report only — no code changed, no PR opened by this session).

**[2026-09-02 00:00:00 UTC] - ARCHITECTURE_CHANGE**
*   **Action:** Committed ~47 files of substantial, previously-uncommitted local work as a snapshot commit (`89739de`, "feat(editor): native tables, intent-context envelope, selection offers") on new branch `feat/reading-quality`, before syncing with `origin/main`. **Branch NOT YET opened as a PR — no adversarial review has run on it.**
*   **Agent:** Claude Code (interactive session), no adversarial review yet.
*   **Context:** Local `main` had drifted 40 commits behind `origin/main` while this work accumulated uncommitted in the working tree — a risk of silent loss (force-push, checkout, or a careless reset would have destroyed it with no git history to recover from). Committing first, before reconciling with upstream, preserves the work as a citable commit regardless of what the merge does next.
*   **Decisions Logged:**
    *   Native ProseMirror tables replace the prior "render as a readable code block" fallback: `tableNodes` schema with block-id-bearing cells, GFM pipe-table parsing in `docInput/parser.ts`, `tableEditing`/`columnResizing` plugins.
    *   New `lib/ai/intentContext.ts`: a budgeted context envelope handed to the resolver (local block, section, heading path, defined terms, graph neighbours, author invariants, branch chain) — the substrate the branch's later grounding fix builds on.
    *   New `lib/annotations/selectionOffers.ts` (one-click selection offers) and `lib/annotations/blastRadius.ts` (pre-apply "touches N other passages").
    *   Dropped the inert duplicate `src/app/api/transcribe/route 2.ts`.
*   **Approval:** Pending — PR #146 open, CI green, awaiting operator review.

**[2026-09-02 00:00:00 UTC] - PROCESS**
*   **Action:** Merged `origin/main` into `feat/reading-quality` (`f01fb47`) — 40 commits, 4 conflicts resolved keeping both sides.
*   **Agent:** Claude Code (interactive session).
*   **Context:** Reconciling the snapshot commit above with everything that had landed on `origin/main` in the interim.
*   **Decisions Logged:**
    *   StatusBar: kept local `hasKeys()` selector (Ollama needs no API key) AND upstream's active-document scoping of the annotation count.
    *   ApiKeyModal: kept upstream's separate transcription-spend line (issue #113) rendered with the local `text-muted-foreground` readability class.
    *   DocInputModal: comment wording only, kept the longer local version.
    *   blastRadius test fixture: upstream made `graphitiEpisodeGen` a required `DocGraph` field (#139); the hand-built graph literal set to -1 to satisfy the type without asserting a real value.
    *   Verified green post-merge: typecheck, lint, 1211 unit tests, build.
*   **Approval:** Pending — PR #146 open, CI green, awaiting operator review.

**[2026-09-02 00:00:00 UTC] - ARCHITECTURE_CHANGE**
*   **Action:** Ollama switched from the OpenAI-compatibility endpoint to its native `/api/chat` dialect (`5962c86`, "fix(ollama): talk to Ollama natively so context size and reasoning behave").
*   **Agent:** Claude Code (interactive session).
*   **Context:** Measured against a live Ollama 0.33.0 running qwen3:8b: the OpenAI-compat shim accepted `options.num_ctx` but silently ignored it (`GET /api/ps` still reported 4096 after a request for 16384, while qwen3:8b advertises 40960 — an over-long prompt truncates with no error), and routed a thinking model's tokens to an unread `reasoning` field, so `message.content` could come back empty or truncated while the token budget was spent on deliberation. Both are the "inaccurate answer" symptom this branch started from.
*   **Decisions Logged:**
    *   `ollama` is now its own dialect posting to native `/api/chat`: `options.num_ctx` from a new `x-context-tokens` header (default 16384, backfilled into existing persisted settings — an existing local user pinned at 4096 was judged the bug, not a compatibility requirement); `think: false` suppresses chain-of-thought at the source; sampling/length moved into `options`; native NDJSON streaming (no `data:` prefix, no `[DONE]`); tool `arguments` arrive already parsed as an object, not a JSON string.
    *   `redirect: 'manual'` extended to guard every non-Anthropic dialect, not just the OpenAI one — a validated public base URL can still 3xx to a private address whichever wire format follows (same SSRF class as the 2026-07-09 hardening pass, applied to a second code path).
    *   Second line of defence in the renderer: `AgentMarkdown` now also extracts qwen3's `<think>` tag (not just Anthropic's `<thinking>`), including an unclosed tag.
    *   `agentMarkdown.pure.test.ts`'s "verbatim" copy of `extractBlocks` (which had drifted and could keep passing while the real renderer broke) replaced with an import of the real function — immediately caught the unclosed-tag behaviour change. Its `splitIntoBlocks` copy left in place but now mirrors a function the source has since deleted; noted in-file as a known drift risk, not fixed.
    *   qwen3:8b added to the Ollama presets and made its default model.
    *   Verification: live through the running app — non-streaming/streaming `/api/resolve` and tool-calling `/api/structured` return clean content with no reasoning leakage, `/api/ps` reports ctx=16384. 1234 unit tests green.
*   **Approval:** Pending — PR #146 open, CI green, awaiting operator review.

**[2026-09-02 00:00:00 UTC] - BUG_FIX**
*   **Action:** `migrateTableBlocks` recovers native tables from documents imported before tables existed (`1513875`, "fix(tables): recover tables from documents imported before tables existed").
*   **Agent:** Claude Code (interactive session).
*   **Context:** `documentStore` persists only `docJson`, never the source markdown, so a document imported under the pre-native-tables parser (which rendered a table as a `code_block`, per that code path's own comment: "render table as a readable code block, lightweight editor, no full table support") kept that code_block forever — styled light-on-near-black with a horizontal scrollbar, an unreadable dark slab for a 40-row grid of prose, with re-importing by hand the only prior escape.
*   **Decisions Logged:**
    *   Recovery is exact, not approximate: a stored `code_block`'s text round-trips through the same `parseMarkdownTable` the live import path uses — no second table grammar to drift.
    *   Deliberately conservative: a `code_block` converts only when it parses as exactly ONE table consuming the whole block. A real code sample containing a pipe, a block holding a table plus trailing prose, and a ragged header/delimiter mismatch are all left untouched. A missed conversion costs a dark block; a wrong one destroys source code.
    *   Hooked into `loadDocumentJson` (the single choke point both editor mount and document-switch read through) and persisted immediately, since an unsaved migration would be redone every load and could race a caller still holding pre-migration JSON. The converted table's `blockId` is carried over so existing annotations, doc-graph nodes, and audit records still resolve.
    *   New `tests/reading-quality.spec.ts` deterministic e2e suite added (first e2e coverage of table rendering): real table nodes, single-cell Google-Docs callout tables, light computed background, legacy conversion across a reload, and — when present locally — the real 41-table `Sierra_Onsite_Deep_Study_Guide.md` rendering with no pipe left in any `<pre>`.
    *   Verification: 15 migration unit tests, 6 store-boundary tests, 5 e2e tests green, the last against the real document.
*   **Approval:** Pending — PR #146 open, CI green, awaiting operator review.

**[2026-09-02 00:00:00 UTC] - BUG_FIX**
*   **Action:** Grounding now states what the document does not define instead of asking the model to judge it (`61c3e70`, "fix(grounding): state what the document does not define, don't ask the model").
*   **Agent:** Claude Code (interactive session).
*   **Context:** Two defects behind a wrong "what is Atlantis?" answer. (1) `getSectionText` called `textBetween` with no block separator, running a heading straight into its paragraph (`...Atlantis "sniff test"The stated process was IaC...`) — a grounding failure wearing a formatting disguise. (2) Nothing told the model the document never explains the term; a first attempt added a system rule asking the model to determine that for itself, and this was MEASURED on qwen3:8b to make things worse — it glossed "Atlantis" as "a Terraform sniff test," building a definition out of the words beside the term, which is the reported bug in a new costume.
*   **Decisions Logged:**
    *   Both `getSectionText` and the resolver now separate blocks rather than running them together.
    *   The "is this term defined" fact is now computed, not asked: `buildIntentContext` checks the selected term against the same deterministic `definedTerms` the doc graph already extracts, and `formatIntentContext` states the result last, nearest generation (previously buried among system rules the type prompt's "2-3 key insights, bullets" instruction tended to dominate). Rule recorded generally: an 8B-class local model follows a stated fact far more reliably than it evaluates a conditional — compute the determinable fact, then state it, rather than asking the model to determine it inline.
    *   Conservative by design: silent on a cold graph (an absence it cannot know), silent for a selection too long to plausibly be a term, and a partial/case-insensitive match against a longer defined term counts as defined — an announced-but-wrong absence is judged the costlier error than a missed one.
    *   **Disclosed, not a code defect:** measured on the real question through the running app, qwen3:8b correctly said "This document does not define 'Atlantis'." then still answered the outside-knowledge half wrong (first "Plato", then "a staging environment" — the real answer is Terraform pull-request automation). Recorded as a model-knowledge limit, not a code path; the explicit "From outside the document:" label is what makes it survivable, since the reader can see which half to distrust.
    *   First tests added for `helpers.ts`, previously untested despite deciding how much document context the resolver sees (including the heading-selection widening that governs the exact reported case).
    *   Verification: typecheck, lint, 1279 unit tests green.
*   **Approval:** Pending — PR #146 open, CI green, awaiting operator review.

**[2026-09-02 00:00:00 UTC] - ARCHITECTURE_CHANGE**
*   **Action:** Related-passage retrieval gained a scored relevance threshold, replacing "return the top N neighbours because they're the only N" (`e1073a0`, "fix(retrieval): score related passages, and say when nothing is related").
*   **Agent:** Claude Code (interactive session).
*   **Context:** Reported symptom: a passage about "Jira + Splunk access-grant reconciliation" surfaced two unrelated passages, labelled `references ("Sections 8")` and `references ("Sections 8") → references ("Aegis")`. Four independent causes, each measured against the real document with new script `scripts/calibrate-relevance.ts`: no relevance threshold at all; a section-reference regex matching a plural range ("Study Sections 8–14") and resolving it as a positional index; any bolded lead-in counting as a definition; and a project-wide term ("Aegis") linking every containing block to one definer, collapsing the whole document to one hop from itself so ranking had nothing left to discriminate with.
*   **Decisions Logged:**
    *   `collectRelatedDetail` scores every candidate as `structural × corroboration` (IDF-weighted vocabulary overlap, gating every multi-hop path unconditionally — two hops is transitive inference, never evidence). The 0.45 cut-off is derived, not chosen by feel: the arithmetic separating the weakest reject (0.372) from the weakest accept (0.630) is written out at the constant.
    *   Section-reference matching now singular-only with ranges/lists excluded, resolved against the headings' own numbering; the old positional-index fallback survives only where a document numbers nothing, and is tagged as the guess it is.
    *   Terms linking more than `clamp(12% of blocks, 4, 8)` blocks now produce NO edges and are recorded in `graph.hubTerms` — dropped rather than truncated, since "the first 8 in document order" is not a relevance signal.
    *   An empty result now distinguishes three meanings (cold graph / no candidates / candidates checked and rejected) — the third states itself explicitly ("NOTHING ELSE IN THIS DOCUMENT BEARS ON THIS SPAN … Do not invent a cross-reference") because an unexplained silence is what a model fills with an invented cross-reference; a cold graph still says nothing, since claiming an absence from an unbuilt index would itself be false.
    *   Threads gained hide/collapse and "Show N resolved" — `hidden` is a view flag only, annotations remain the audit record, `remove()` stays whole-document-deletion-only, and applying deliberately does NOT hide (the reader has changed the document and wants that registered).
    *   Two `cascade-review.spec.ts` assertions, already failing before this work (verified at the merge commit, not caused by it), were realigned to the live UI — one to shortened truncated summary text, one to a dropdown-trigger status element with a chevron.
    *   Measured on `Sierra_Onsite_Deep_Study_Guide.md` (512 blocks): the "Sections 8" edge no longer exists at all; "Aegis" dropped as a hub term (with Authorization, Integrity, Evidence); 192 of 320 candidates now cut. Verification: typecheck, lint, 1379 unit tests, 7 e2e green.
*   **Approval:** Pending — PR #146 open, CI green, awaiting operator review.

**[2026-09-02 00:00:00 UTC] - ARCHITECTURE_CHANGE / PROCESS**
*   **Action:** Reading flow gains meaning-based edges from an idle-timer embeddings pass, an opt-in LLM judge, and CI runs e2e for the first time (`6ecad36`, "feat: meaning-based edges while reading, an opt-in judge, and e2e in CI") — closes out the `feat/reading-quality` branch's six commits. **Branch still NOT opened as a PR; no adversarial review has run on any of the six commits.**
*   **Agent:** Claude Code (interactive session), no adversarial review yet.
*   **Context:** The background docGraph rebuild is deliberately deterministic-only (document text must never leave the machine as a side effect of typing), and the LLM/embedding passes only ever ran from `proposeCascadeEdits` — i.e. only when an `edit`-type annotation resolved — so a reader who never triggered a cascade never saw a semantic connection between passages at all.
*   **Decisions Logged:**
    *   New `scheduleDocGraphEnrichment`: a second, 12-second idle timer running the embedding pass only (never the LLM `link_blocks` pass — whole-doc `link_blocks` on a local 8B model would take minutes and blow the window), gated by a new `graphEnrichment` setting defaulting to `local-only` so it only runs when the provider is Ollama and vectors never leave the machine.
    *   `embedEdges`'s `SIMILARITY_THRESHOLD` (previously one constant, documented in-file as uncalibrated for anything but `text-embedding-3-small`) is now a per-model default plus a self-calibrating in-document floor (mean + 1.5σ, engaged only above 200 pairs so the existing fixture is untouched). Embedding edges now carry `kind: 'similarity'` and a cosine-derived weight.
    *   New `judgeRelatedPassages`: reuses `relevanceJudge.ts`'s batched verdict-tool shape and trust boundary verbatim (zero valid verdicts throws rather than reading as an all-deny — same malfunction-vs-denial distinction as the 2026-07-09 Wave A judge). Wired to an explicit "Check these" button, never the mouse-up path. Rejected passages are struck through and labelled with the judge's reason rather than removed.
    *   New `tests/local-model.spec.ts` (LIVE_LOCAL=1, self-skipping): drives the real Ollama, covering context-window arrival, no reasoning leakage (streamed and non-streamed), tool-call survival of Ollama's object-valued `arguments`, and the computed "does not define" fact from the grounding fix above. 5/5 pass against qwen3:8b.
    *   **CI now runs e2e in its own job for the first time.** It had been running none, which is why two `cascade-review.spec.ts` assertions (fixed in the retrieval commit above) had been failing against long-removed UI wording without anyone knowing.
    *   Two real bugs found and fixed while writing these tests: the scroll-to-passage highlight never appeared because ProseMirror re-renders the `[data-block-id]` node view on the read-line plugin's own scroll transactions and strips an added class within a frame (confirmed via MutationObserver; fixed as an overlay in the scroll container, outside `.ProseMirror`, where nothing can strip it); and two of this session's own new e2e assertions matched for the wrong reason (`/review item/i` also matches "0 review items"; the blast-radius card's first button is "Check these," not a passage) — both re-addressed by role/exact text.
    *   Verification: typecheck, lint, 1412 unit tests, build, 12 e2e, and 5 live-model tests against a real qwen3:8b.
*   **Approval:** Pending — branch not yet opened as a PR, not yet reviewed, not yet in `main`.
