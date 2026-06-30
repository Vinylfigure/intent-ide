# Raw Reflection Log

This file contains detailed, timestamped, and task-referenced raw entries from the AI's "Task Review & Analysis" phase. It is the initial dump of all observations. 

**AI Directive:** Once information has been successfully transferred and distilled into `consolidated_learnings.md`, the corresponding original entries here MUST be removed to keep this file focused on recent, unprocessed reflections.

---

Date: 2026-06-29
TaskRef: "v8.3 Wave 3 Refinements — Reviewable Multi-Region Edits"
Learnings:
- **One source of truth + a single authoritative writer beats syncing three UIs:** Inline per-region controls, the multi-diff commit modal, and the cascade list all needed to agree on which edits are accepted/rejected. The clean design was to keep per-edit status in exactly one place (the `proposedChangePlugin` via `setProposedEditStatus`/`getProposedAnchors`) and have every surface READ it, while only the commit modal WRITES the final decision at apply time (`applyProposedEdits(view, acceptedIds)`). The inline and list controls are status-only and defer mutation to the batched apply. This avoids the classic three-way-sync bug where each surface holds its own copy and they drift. Troublemaker specifically probed "source-of-truth divergence" and confirmed it is not a bug precisely because there is only one writer.
- **Removing a bypass is as important as adding the gate:** The previous multi-edit path direct-applied and skipped `SemanticCommitModal` entirely — the modal existed but was bypassed for the >1-edit case. Routing the multi-edit case through the modal (and applying only the accepted subset) is what actually closes the HITL gate for multi-region edits. A gate that some paths route around is not a gate.
- **CascadeList-staleness lesson — gate review UI on resolution status, not on activity:** The cascade list initially showed stale "Pending" rows after an apply because it was gated on the card being active rather than on `status==='resolved'`. Derived review surfaces must be gated on the authoritative lifecycle status, and the owning component (`AnnotationCard`) must explicitly clear decorations on apply/dismiss/deactivate. "It looked applied but the list still said Pending" is the symptom of gating on the wrong signal.
- **Outside-click dismissal must whitelist the control's own DOM:** Clicking a region's inline Accept/Reject was being treated as an outside-click and dismissing the very control being clicked. Ignoring `[data-proposed-edit-id]` in the outside-click handler fixed the one-click switch. Any floating control with an outside-click-to-dismiss needs an explicit allowlist for its own trigger surface.
- **Record a consistent old range for multi-region change entries:** Multi-region edits must log the same anchor basis (`ap.to`) for the "old" range so the change log and audit stay coherent across regions applied in one transaction.
- **Anchor-read-before-clear race is safe when reads precede the clear:** Troublemaker flagged a potential race between reading anchors for apply and clearing decorations; confirmed not a bug because the accepted anchors are read before decorations are cleared within the same apply flow.
Difficulties:
- The subtlety was entirely in ordering and ownership, not in any single component: which surface owns status, which owns the decoration lifecycle, and when decorations clear. Getting `AnnotationCard` to own the lifecycle (show on active + resolved + >1 edit; clear on apply/dismiss/deactivate) was the linchpin.
Successes:
- Multi-region edits are now genuinely reviewable across three coherent surfaces with no drift.
- The HITL gate is fully satisfied for multi-region edits (no direct-apply bypass remains).
- `npm run typecheck` 0 errors, `npm run test` 194 passing, `npm run build` clean.
- Committed and pushed to private `Vinylfigure/intent-ide` `main` (3 commits on `origin/main`).
Improvements_Identified_For_Consolidation:
- "One source of truth, one authoritative writer, many readers" is the reusable pattern for any feature where multiple UIs edit the same set of pending decisions. Promote to consolidated_learnings.
- Derived/review UIs must gate on the authoritative lifecycle status (`status==='resolved'`), and the owning component must explicitly clear derived decorations on terminal transitions — otherwise stale state lingers.
- Floating controls with outside-click-to-dismiss need an allowlist (`[data-proposed-edit-id]` here) for their own trigger DOM.
- Optional next polish: write accept/reject toggles inside the modal back to the plugin status so all surfaces stay live-synced even before apply (currently the modal is authoritative only at apply).
- A pushed secret is not the same as a rotated secret: the code is on private `origin/main`, but the `.env` key now lives in remote history and still requires rotation. Privacy mitigates, it does not resolve.
---

Date: 2026-06-29
TaskRef: "v8.3 — Model/API Refresh + In-IDE Multi-Region Agent Edits (Waves 1-3)"
Learnings:
- **The model bump's real failure was sampling params, not the model IDs:** Newer Claude models (opus-4-7, opus-4-8, fable-5, mythos) return HTTP 400 when sent sampling params like `temperature`. The agent calls were failing not because of wrong model names but because every route unconditionally attached `temperature`. Centralizing this in `modelRejectsSampling()` (`modelCapabilities.ts`) and omitting the param across `/api/resolve`, `/api/classify`, and `/api/generate` was the actual fix. Lesson: when an API starts 400ing after a model swap, suspect request-shape/param compatibility before suspecting the model identifier.
- **Migrate stale persisted model IDs down to a safe default, never up:** `normalizeClaudeModel()` maps unknown/legacy localStorage model IDs to Sonnet 4.6 rather than silently upgrading users to Opus. Silent upgrades to a more expensive multi-call model would be a cost surprise; migrating to the safe default is the conservative choice. The cost/diversity notices in ApiKeyModal make the Opus/Fable trade-off explicit instead of hidden.
- **Pin auxiliary calls to a cheap model regardless of selection:** Context compaction is pinned to Haiku 4.5 even when the user picks Opus. Background/utility LLM work should not inherit the user's premium model choice.
- **Replace regex extraction with provider-agnostic tool-calling when the output is structured:** The old `parseSuggestedEdit` regex was brittle. A `propose_edit` tool on `api/structured` lets the model emit structured edit proposals directly, which is both more reliable and provider-neutral. This is the backbone that turns the read-only cascade into editable multi-region proposals.
- **Anchor agent-proposed edits to live positions by fingerprint, and drop what you cannot anchor:** `proposeCascadeEdits()` matches each proposal's `targetText` against current document text and discards unanchorable or overlapping proposals. This is safer than trusting stale offsets — a disappeared proposal is correct behavior when the doc drifted.
- **Apply must validate against live text, not cached store positions:** The latent stale-position bug came from apply reading Zustand anchor positions captured at resolution time. `applyProposedEdits.ts` re-validates by fingerprint and applies all regions in a single descending transaction (descending so earlier edits don't shift later offsets). This is the same "read fresh from the document, not from closure/store" lesson that bit the Regenerate button in Phase 14, now applied to positions.
- **Audit writes must record their own failure:** `logResolutionAudit` was fire-and-forget; a rejected promise silently dropped an EU AI Act record. Adding `.catch()` that sets `resolution.auditFailed` makes the compliance gap visible. For regulated logging, a dropped write is worse than a thrown error.
- **`.claude/agents/*.md` as authoritative runtime definitions, root `agents.md` as a pointer:** Keeping a single source of truth for agent roles (the `.claude/agents/` directory the harness actually loads) and demoting the root summary prevents drift between documented and runtime agent behavior.
Difficulties:
- **Worktree isolation was unavailable because git was initialized mid-session:** The project was not a git repo when the work started, so isolating the change on a separate worktree/branch was not an option — the work landed directly and the repo was initialized afterward (`main`, two commits). Future multi-wave work should initialize git first so isolation and rollback are available from the start.
- **Read-line-aware decoration positioning required mapping through `tr.mapping`:** `proposedChangePlugin.ts` decorations must survive document edits between proposal and apply, so positions are re-mapped on every transaction rather than stored as fixed offsets.
Successes:
- The newer-model agent-call failures are fully resolved; the gate is centralized and reusable.
- The cascade is now genuinely editable multi-region instead of read-only.
- `npm run typecheck` (0 errors), `npm run test` (194 passing, +42 new for modelCapabilities + settings migration), and `npm run build` (clean) all pass.
- The repo is now under version control on `main`.
Improvements_Identified_For_Consolidation:
- Any new Claude API route must consult `modelRejectsSampling()` before attaching sampling params — this should become a documented convention, not tribal knowledge.
- The "read fresh from live state, not cached positions/closures" rule now spans Regenerate (Phase 14) and apply (v8.3). It belongs in consolidated_learnings as a general anti-pattern.
- Initialize git at project start so worktree isolation and clean rollback are always available.
- Rotate-then-push: secrets that reach git history block remote push and require key rotation + history scrub. `.gitignore` for `.env` must precede the first commit.
- Optional Wave 3 follow-ups (inline per-edit Accept/Reject, multi-diff SemanticCommitModal, navigable cascade list) are the natural next UI layer on top of the now-editable proposals.
---

Date: 2026-03-16
TaskRef: "Phase 14 — Bug Fixes and UX Hardening"
Learnings:
- **Defensive property access is mandatory for persisted Zustand stores:** Legacy data in localStorage may lack properties added in later versions. The `collectionIds` crash in DocumentHubSidebar is a textbook example: the interface defined the field, but old serialized docs did not have it. Always use `(field ?? default)` at access sites AND add migration in `onRehydrateStorage` to normalize the shape.
- **localStorage quota is a real constraint for persisted stores:** `changesStore` was unbounded and could exceed the ~5MB localStorage quota. The fix pattern is: (1) `partialize` to cap array sizes and exclude non-essential fields like snapshots, (2) wrap `setItem` in try/catch, (3) emergency-prune oldest entries on quota error.
- **Selection-triggered input is more natural than right-click-only:** Adding mouseup and keyboard selection handlers to `contextMenuPlugin.ts` makes the FloatingIconBar appear whenever the user selects text, which is the natural first step toward annotating. Right-click remains supported but is no longer the only trigger.
- **Annotation expand/collapse scope matters:** When the entire card div has an onClick for collapse, any click anywhere in the body (including interacting with resolution content, buttons, or links) triggers collapse. Moving the handler to the header row only is the correct boundary.
- **Nested scrolling is a common layout bug in panel-based UIs:** The AppShell sidebar wrapper was set to overflow-auto while each panel inside also had its own overflow-auto, producing double scrollbars. Fix: parent gets overflow-hidden, children manage their own scroll.
- **Auto-selecting the most recent document on startup prevents empty-state confusion:** Showing a new-document modal when docs already exist is disorienting. The startup sequence should check for existing docs first and only show the modal when none exist.
- **DiffView with line numbers is far more useful than raw text diffs:** ChangeEntry previously showed raw before/after text. Adding a structured DiffView with line numbers and expand/collapse per entry makes the changes panel genuinely reviewable.
Difficulties:
- The changesStore quota fix required careful ordering: partialize runs before persistence, but emergency pruning runs inside the custom storage wrapper. Both paths needed to be compatible without data corruption.
Successes:
- All crash bugs eliminated. 152 tests passing.
- Selection-triggered annotations make the core interaction loop much more discoverable.
- Formatting toolbar provides basic rich-text editing that was previously missing.
- `npm run typecheck` (0 errors), `npm test` (152 passing), and `npm run build` (clean) all pass.
Improvements_Identified_For_Consolidation:
- Every persisted Zustand store should have: (1) defensive defaults at all access sites, (2) migration in onRehydrateStorage, (3) partialize with sensible caps, (4) quota-safe custom storage.
- Selection-based triggers should be the primary annotation entry point; right-click and keyboard shortcuts are secondary.
---

Date: 2026-03-16
TaskRef: "Phase 13 — Visual Hardening"
Learnings:
- **Hierarchy fixes are more valuable than theme swaps:** The app looked weak mostly because every surface had the same visual weight. Stronger stage/panel/card separation immediately improved readability without changing the interaction model.
- **Status chips outperform flat muted labels in review software:** Counts, save state, approval states, and provider info are easier to scan when they are discrete chips instead of washed-out inline text.
- **Editor framing matters:** Wrapping the editor in a distinct paper-on-stage treatment makes the document feel like the primary artifact instead of just another pane.
- **A warmer palette solved more of the “everything is gray” problem than adding more color tokens:** The product already had good accent colors for annotation types; the bigger issue was neutral surfaces that were too flat and too similar.
Difficulties:
- The visual pass had to stay compatible with the freshly landed Phase 8 structure. The main constraint was to strengthen hierarchy without reintroducing layout complexity or new interaction risk.
Successes:
- The shell, document hub, annotations, changes, audit, and status bar now read as one coherent product.
- `npm run typecheck` and `npm run build` both passed after the polish pass.
Improvements_Identified_For_Consolidation:
- A later design-system phase should extract these new surface treatments into reusable primitives instead of repeating class combinations.
- Modals and secondary overlays still need the same hardening treatment to fully finish the visual system.
---

Date: 2026-03-16
TaskRef: "Phase 8 — Coherent Document Navigation and Annotation Review"
Learnings:
- **Migrations are cleaner when legacy state is treated as read-only input:** Keeping `projectStore` only as a one-time migration source avoided another dual-write system. The key pattern is: import once, mark migrated, stop reading legacy state, do not delete old storage immediately.
- **Exact-anchor grouping is good enough for the first coherence pass:** `locationGroupKey = documentId:from:to` is intentionally simple. It avoids premature fuzzy re-anchoring logic while still giving the UI a stable grouping primitive for active-document review.
- **One shared composer is more important than one shared trigger:** The user confusion came from mismatched annotation surfaces. Reusing the same composer across selection capture, thread drilling, and spin-off flows immediately reduces product inconsistency, even before deeper voice/presence work.
- **Adaptive concise beats static normal as the default:** The previous "normal" baseline made the UI feel chatty and slow. Encoding the default as a function of `scope + type` gives a much better product default without introducing a new persisted verbosity mode.
- **Grouped review objects need only a thin persistence layer to be useful:** A lightweight `ChangeSet` model tied to root annotation threads was enough to replace the flat review list with something legible. Full workflow sophistication can come later.
- **Test runner boundaries matter:** The workspace had Playwright and dependency tests leaking into Vitest. Explicit `include` rules in `vitest.config.ts` restored trustworthy verification much faster than trying to interpret mixed test output.
Difficulties:
- Phase 8 touched nearly every active surface at once: storage, navigation, editor switching, annotation creation, review panels, and tests. The main risk was not type errors; it was preserving a coherent mental model across all of them.
- The existing codebase already had a "flat docs" story in memory-bank docs but still rendered the old project UI. Untangling this required treating product reality as the shipped UI, not the stated architecture.
Successes:
- `documentStore` is now the active source of truth and supports collections plus one-time legacy import.
- Annotation capture is visibly more coherent because the same composer now appears across the three key entrypoints.
- The changes panel now reflects reviewable change-sets instead of only raw events.
- `npm run typecheck`, `npm test`, and `npm run build` all pass after the implementation.
Improvements_Identified_For_Consolidation:
- Future phases should preserve the "one primary object per layer" rule: one document store, one capture component, one grouped review abstraction.
- When using Vitest in a Next.js repo with Playwright and heavy dependencies, always pin `include` patterns early to avoid false failures from node_modules or E2E suites.
- Exact-anchor grouping is a strong default for v1, but any future collaborative editing or server persistence phase should budget for re-anchoring and conflict-resolution primitives.
---
Date: 2026-03-12
TaskRef: "Initial Setup of Intent IDE Memory Bank"
Learnings:
- Established the Memory Bank architecture to separate high-level system patterns from active coding context.
- Documented strict project constraints (e.g., no innerHTML, Graphiti MCP server configuration, token-level entropy math).
Difficulties:
- None during setup.
Successes:
- Successfully broke down a monolithic PRD into a modular, AI-readable file structure.
Improvements_Identified_For_Consolidation:
- N/A
---

Date: 2026-03-15
TaskRef: "UX Audit — Hands-on Testing"
Learnings:
- Core architecture can pass typecheck/build but still have severe usability gaps. The 5-phase build produced impressive infrastructure (MADS, GraphRAG, audit logging) but basic actions like "Apply" were broken.
- Document persistence was completely absent — every reload lost all work. This is a showstopper that should have been caught earlier.
- Low-contrast text (`#7a756d` on white, ~3.5:1 ratio) was used pervasively as hardcoded hex values rather than via CSS variables, making it resistant to a single-point fix.
- 6 annotation types (question, fix, correction, restructure, explore, thought) were confusing even to the creator. Consolidation to 4 (ask, edit, dig, flag) with invisible classification was the right call.
Difficulties:
- None during audit itself — the audit was user-driven and produced a clear prioritized list.
Successes:
- The audit produced a concrete, sequenced overhaul plan with verification criteria per wave.
Improvements_Identified_For_Consolidation:
- Always build persistence + readability FIRST before advanced features.
- Use CSS variables for all color tokens from the start — never hardcode hex values.
---

Date: 2026-03-16
TaskRef: "Wave 0 + Wave 1 — Reliability-First UX Overhaul"
Learnings:
- **Document persistence pattern:** `documentStore.ts` uses a flat document hub model with localStorage content storage keyed by `intent-ide-doc:{id}`. Auto-save uses a 5-second debounce on ProseMirror `docChanged` transactions. The `beforeunload` event warns users about unsaved changes.
- **Parser rewrite insight:** The original `parser.ts` treated all content as paragraphs. Bullet lists, ordered lists, blockquotes, and tables all need explicit detection patterns. Pipe-table detection (lines matching `|...|...|`) and HTML table/list conversion were added for import fidelity.
- **Button fix patterns:** Each of the 6 broken buttons had a different root cause:
  - Apply: stale ProseMirror positions + no idempotency guard
  - Add to doc: missing `suggestedEdit` for non-edit types + no fallback insertion strategy
  - Keep digging: empty conversation array meant `continueThread` had no context
  - Tweak it: auto-sent a canned message instead of collecting user input
  - Follow-up: `FollowUpInput` only rendered in one code path, missing backward-compat path
  - Show affected: cascade results were only shown as transient toast, not persisted in conversation
- **Readability fix:** The `--muted-foreground` HSL value `30 8% 32%` achieves ~6:1 contrast ratio on white, satisfying WCAG AA. The key was replacing all hardcoded `#7a756d` hex values with the CSS variable so the fix propagates everywhere.
- **AGENTS.md as swarm config:** The multi-agent swarm config establishes role boundaries that prevent overlapping work between AI agents. Key insight: the workflow protocol (requirement -> plan -> execute -> test -> review -> verify -> document) creates a natural quality gate chain.
Difficulties:
- None noted — plan was well-specified and execution was straightforward.
Successes:
- All 6 broken buttons fixed with specific architectural solutions (not band-aids).
- Document persistence works across reloads.
- Contrast ratio meets WCAG AA.
- typecheck (0 errors) and build (clean) both pass.
Improvements_Identified_For_Consolidation:
- Button action handlers should always have an idempotency guard (disable after success state).
- Conversation-dependent actions should always verify conversation array is non-empty before proceeding.
---

Date: 2026-03-16
TaskRef: "Wave 2 — 4-Intent System + Invisible Classification"
Learnings:
- **Type consolidation strategy:** When reducing annotation types from 6 to 4, maintaining a `LegacyAnnotationType` union and a `mapLegacyType()` function allows safe migration of persisted data without data loss. The migration runs on store rehydration (`onRehydrateStorage`), so users with existing localStorage data transparently upgrade.
- **Invisible classification UX pattern:** Removing the upfront intent picker and replacing it with AI classification behind the scenes dramatically simplifies the interaction model. The key insight: users should type/speak naturally and the system should classify, not the other way around. The safety valve is the clickable badge override on the result card.
- **Mutating vs non-mutating overrides:** When a user overrides a type badge, some overrides are cheap (just relabel the annotation — e.g., ask<->dig) while others are expensive (must re-run resolution — e.g., anything<->edit, because edit routes through MADS). The distinction prevents unnecessary re-computation.
- **Voice pipeline simplification:** The old voice flow had an intermediate ActionPicker step where the user had to select a type after recording. Removing this step and going straight to `createAnnotationFromText` (which triggers classification) eliminates a full interaction step. Fewer steps = less friction = more annotations.
- **Prompt consolidation:** Three separate prompts (fix, correction, restructure) that had significant overlap were merged into a single `edit` TYPE_PROMPT. This reduces prompt maintenance surface and makes the routing logic cleaner (single `annotation.type === 'edit'` check instead of triple OR).
- **MADS routing by type:** The complexity classifier in `mads.ts` now has a simple mapping: `edit` always routes through MADS (multi-agent debate), `ask`/`dig` always use single-agent, and `flag` falls through to LLM-classified complexity. This is more deterministic than the previous approach.
- **CSS backward compatibility:** When introducing new annotation type CSS classes (`annotation-ask`, etc.), keeping the legacy classes (`annotation-question`, etc.) in the stylesheet prevents visual breakage for any components that haven't been updated yet.
Difficulties:
- None noted — the Wave 2 plan was well-specified and the 4 sub-waves (2A-2D) had clear boundaries.
Successes:
- FloatingIconBar transformed from a confusing 6-icon picker to a clean single input bar.
- Voice pipeline lost an entire interaction step (ActionPicker).
- typecheck (0 errors) and build (clean) both pass.
- Legacy data migration is transparent to users.
Improvements_Identified_For_Consolidation:
- When reducing a type system, always provide: (1) a legacy type union, (2) a mapper function, (3) a store migration hook. This pattern is reusable.
- Prefer invisible classification with override over upfront selection. The AI should do the cognitive work, not the user.
- Distinguish mutating from non-mutating overrides to avoid unnecessary re-computation.
---

Date: 2026-03-16
TaskRef: "Wave 4 — Positive Friction (Gated Apply + Inline Provocations) + Troublemaker Bug Fixes"
Learnings:
- **Provocation extraction pattern:** The `extractProvocation()` function in `mads.ts` works by parsing the CHALLENGES section of the MADS debate output and selecting the strongest Troublemaker objection. It only fires when the Judge verdict is MODIFY or REJECT — APPROVE verdicts mean the Troublemaker's concerns were addressed. This is a good pattern: surface dissent only when it wasn't resolved in the debate.
- **Gated apply as positive friction:** Adding a two-step confirmation for high-risk edits (1. read the provocation, 2. explicitly acknowledge it) is lightweight enough to not annoy users but heavy enough to prevent automation bias. The key insight: the gate is conditional — only when `usedMADS=true` AND a provocation exists. Low-risk edits (single-agent) are not gated.
- **Stale closure bugs in React + Zustand:** The Regenerate button was reading from a stale closure over the annotation object. Fix: read fresh from `useAnnotationStore.getState().annotations[id]` at call time. This is a recurring pattern in React components that capture Zustand state in callbacks — always read fresh from the store inside event handlers, not from closure-captured props or state.
- **Classification must be wired explicitly:** `createAnnotationFromText` was not calling `classifyAnnotation()` — it was defaulting all annotations to 'flag'. The invisible classification UX only works if the classification actually runs. Lesson: when building "invisible" features, explicitly verify the invisible step executes by testing the output type distribution.
- **Parent-child linkage timing:** Adding 'pending' to a parent's childIds before the child annotation has a real ID creates phantom references. The fix: handle linkage inside `createAnnotationFromText` after the real annotation ID is assigned. Lesson: never store placeholder IDs in relational arrays — wait for the real ID.
- **MADS_ACTIONS key mismatch:** When consolidating annotation types from 6 to 4, the `MADS_ACTIONS` map in `mads.ts` was not updated from old keys (correction/restructure/fix/thought) to new keys (edit/flag). This caused silent failures in MADS routing. Lesson: when renaming type keys, grep for ALL maps/objects that use the old keys.
- **parseSuggestedEdit scope:** Running `parseSuggestedEdit` on non-edit annotations (like ask/dig/flag) produced spurious results because the parsing logic looked for edit-like patterns in any response. Gating it behind `annotation.type === 'edit'` prevents this. Lesson: parsing functions that assume a specific content shape should be gated behind the content type that guarantees that shape.
- **Double-click race conditions:** The Regenerate button could be clicked multiple times before the first resolution completed, causing multiple concurrent resolution requests. Fix: disable the button while `isResolving` is true. Lesson: any button that triggers an async operation should have a disabled guard tied to the operation's loading state.
Difficulties:
- The 6 Troublemaker bugs were discovered during QA testing, not during development. This validates the value of the Troublemaker agent role in the swarm.
Successes:
- All 4 waves of the Reliability-First UX Overhaul are complete.
- 148 tests written and passing.
- 6 critical bugs caught by Troublemaker and fixed.
- typecheck (0 errors) and build (clean) both pass.
Improvements_Identified_For_Consolidation:
- When renaming type/key systems, always do a full grep for all maps, objects, and switch statements that reference the old keys.
- In React + Zustand, always read fresh state from `store.getState()` inside event handlers, not from closure-captured state.
- "Invisible" features (like auto-classification) must be explicitly tested to verify the invisible step actually executes.
- Never store placeholder IDs in relational arrays — wait for the real ID to be assigned.
- Any async-triggering button needs a disabled guard tied to the operation's loading state.
---

Date: 2026-03-16
TaskRef: "Wave 3 — Recursive Drilling + Verbosity Control + Annotation Map"
Learnings:
- **Paragraph-level drilling over sentence-level:** When splitting AI responses into clickable blocks for recursive annotation drilling, paragraph-level granularity is the right choice because it is native to the markdown AST. Sentence splitting would require fragile regex or NLP-based segmentation that breaks on edge cases (abbreviations, inline code, numbered lists). Paragraphs are the natural unit of thought in markdown.
- **DrillMenu positioning:** The DrillMenu is positioned at the click point rather than anchored to the paragraph element. This is more intuitive because the user's attention is already at the click location.
- **Three drill actions cover the use cases:** "Dig deeper" (explore further), "What's this mean?" (seek clarification), and "Edit this" (request changes) map cleanly to the dig/ask/edit annotation types. No need for a "flag" drill action since flagging a sub-paragraph of an AI response is not a natural workflow.
- **Verbosity as a multiplier pattern:** Rather than having entirely different prompts per verbosity level, the approach of (1) multiplying token limits by a constant factor and (2) appending short instruction text to the existing prompt is cleaner and more maintainable. The `VERBOSITY_MULTIPLIER` map (0.5x, 1x, 2x) and `VERBOSITY_INSTRUCTIONS` map keep verbosity logic centralized in `resolver.ts`.
- **Conditional regenerate button:** The Regenerate button only appears when verbosity differs from `normal`, preventing UI clutter for the default state. This is a good pattern for any setting that has a default — only show the action button when the user has deviated from default.
- **Annotation minimap design:** The `AnnotationMap.tsx` uses proportional positioning (annotation position / document height * map height) for dot placement. This creates an intuitive spatial correspondence between the minimap and the document. The type legend with counts serves double duty as a filter and summary.
- **List/map toggle pattern:** Adding a view toggle (list vs. map) in the panel header is a low-friction way to offer an alternative visualization without changing the panel's purpose or adding a new sidebar.
Difficulties:
- None noted — Wave 3 had clear specifications and well-bounded sub-waves.
Successes:
- Paragraph-level drilling works cleanly with the markdown AST without fragile text splitting.
- Verbosity control is centralized (resolver.ts) with per-annotation state.
- Annotation minimap provides a document-level overview that the list view cannot.
- typecheck (0 errors) and build (clean) both pass.
Improvements_Identified_For_Consolidation:
- When adding interactive behavior to rendered content (like clickable paragraphs), work with the content's native structure (markdown AST paragraphs) rather than imposing an artificial structure (sentence splitting).
- For settings with a meaningful default, only show action buttons (like Regenerate) when the user has deviated from the default.
- Multiplier-based approaches (0.5x/1x/2x) to modifying LLM parameters are more maintainable than separate code paths.
---
