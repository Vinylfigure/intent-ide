# Changelog

All notable changes to the Intent IDE project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2026-07-09] v8.4 (candidate) — Precision-First Cascade Graph

Rebuild of the cascade around a block-keyed document dependency graph. Built from `docs/fable5-cascade-brief.md` (local, untracked). Shipped as 8 commits (`d7e1a23..bafccea`) on branch `claude/cascade-graph` — **PR #4 open, pending merge** (`main` is branch-protected).

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
- Landed as PR #4 (https://github.com/Vinylfigure/intent-ide/pull/4) — pending merge; not yet on `main`.

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
