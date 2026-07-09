# System Patterns: Intent IDE (Cascade v2 — roadmap complete 2026-07-09)

## 1. System Architecture Overview
Intent IDE moves away from standard monolithic LLM calls (simple RAG) to a structured, agentic cognitive architecture. The system is divided into three primary layers:
1. **The Capture & Interaction Layer (Frontend):** Next.js/React using `shadcn/ui` and `assistant-ui` for text selection, voice capture, and rendering streaming Markdown with `<Reasoning>` blocks and token-level uncertainty highlights.
2. **The Orchestration Layer (Middleware):** A LangGraph-powered state machine that routes user intents to specialized sub-agents and manages the Multi-Agent Debating System (MADS).
3. **The Semantic Memory Layer (Backend):** A temporal Knowledge Graph (powered by Graphiti/FalkorDB via the Model Context Protocol) that stores document structure, annotations, and explicit dependency chains for multi-hop conflict detection.

---

## 2. Core Domain Objects (Version Control Data Model)
The application state fundamentally operates as a Git-style version control system, completely masked from the user via accessible language.

* **Source:** The base document. Mutable and versioned. Every state is preserved immutably.
* **Annotation:** A user reaction anchored to a specific text scope. Contains the voice transcript, classified intent type (`ask`, `edit`, `dig`, or `flag`), and the Context Package. Type is auto-classified by AI; users can override via clickable badge.
* **Resolution:** The output from the MADS pipeline. Contains the proposed "Semantic Commit," the agents' reasoning chain, and token-level uncertainty entropy.
* **Change:** A tracked, scope-locked modification. Represents the diff of an accepted Resolution. Contains a timestamp, author ID, and a link to the originating Annotation for compliance audit trails.
* **Session Context:** A highly compressed, running knowledge graph representation of everything the user has done, learned, and decided during the session.

---

## 3. The Semantic Memory Layer: GraphRAG & Graphiti
To successfully detect the "blast radius" of a user's edit, standard vector databases are insufficient because they lack multi-hop reasoning. The system must implement **GraphRAG** using a temporal knowledge graph.

### 3.1 Graph Construction & Entity Resolution
* **Nodes & Edges:** The document is parsed (e.g., via Docling) and segmented. Syntactic dependency parsing extracts Subject-Relation-Object triples (e.g., `[Clause 4] -> CONSTRAINS -> [Clause 9]`).
* **Entity Resolution (Denoising):** Because LLMs generate noisy graphs, the system MUST implement an entity resolution/deduplication function (`ϕ: E ↦ E*`) before querying. Duplicate entities (e.g., "SaaS", "Software as a Service") must be merged into canonical nodes to prevent the graph from degrading into vanilla RAG.
* **Temporal Tracking:** Graphiti tracks bi-temporal data. When a user overrides a previous rule, the old edge is NOT deleted. It is marked with an `invalid_at` timestamp. This preserves the historical context for the audit trail.

### 3.2 The Cascade Check (Two Lanes; docGraph is Primary as of v8.4)
There are two cascade lanes. As of v8.4 the **editable** lane runs on a local, block-keyed **document dependency graph** (`src/lib/graphrag/docGraph.ts`) rather than the Graphiti entity graph:

**Lane A — docGraph (editable, primary):**
1. **Anchor:** Every block-level node carries a stable `blockId` attr (`schema.ts` `withBlockId` + `blockIdPlugin.ts`). BlockId — not string matching — is the anchor of record. Paste mints fresh ids (`parseDOM` ignores `data-block-id`); duplicate ids from node splits are re-stamped (keeper = first non-empty occurrence).
2. **Graph build (incremental as of Wave B, PR #10):** Nodes = blocks keyed by `blockId`; edges = typed relations (`CascadeEdgeType`: defines/references/depends-on/implements/tests/contradicts/duplicates) with source-tagged provenance — edge sources are now **deterministic extractors** (cross-refs→headings, defined terms, duplicated sentences; always run), the validated **`link_blocks` LLM pass**, **embeddings** (`/api/embed` + `embedEdges.ts`, provider-keyed vector cache, 300-block cap, transient-throw / permanent-null contract so transient failure is never cached), and **Graphiti entities** (`augmentWithGraphitiEdges`, Wave D). FNV-1a `contentHash` keys an LRU-8 cache with inflight dedupe. **Incremental-rebuild rule:** changed-block re-extraction is SEEDED from the prior graph's adjacency — unseeded re-extraction monotonically decays LLM edges. **Chunking rule:** single LLM call up to a 150-block threshold, chunked extraction above it — unconditional chunking regressed recall in the mid-size band the single call handled; when replacing a bounded mechanism, check the band between the old and new limits. Payloads carry `headingPath` for context.
3. **Egress boundary:** `scheduleDocGraphRebuild` (background, on typing) is deterministic-only — document text never leaves the machine as a side effect of typing. The LLM pass runs lazily inside the user-initiated cascade.
4. **Traversal (source-aware as of Wave D, PR #12):** `getNeighborhood` BFS from the primary edit's block, 2 hops, ≤24 candidate blocks (block COUNT is capped; block text is never truncated). It returns `{hop, sourceRank}` per candidate, and candidate ordering under the 24-block budget is **SOURCE_PRIORITY-aware**: selection under a budget must be source-quality-aware, or low-precision sources (graphiti co-mentions) evict high-precision ones (LLM-attested dependents).
5. **Proposal:** The model sees only neighbor blocks (`blockId` + text) and returns `propose_edit` tool calls. Anchoring is blockId-first (`blockTextRange`) with a neighborhood-gated `findTextInDoc` fallback; overlapping/duplicate targets are dropped first-proposal-wins. All proposals flow into the existing HITL review surfaces and the validate-or-abort single-transaction apply.

**Lane B — Graphiti bridge (REAL as of Wave D, PR #12):** `augmentWithGraphitiEdges` feeds entity co-mention edges into the docGraph as an edge source, bounded on the correct axis: ≤12 entities and ≤120 edges per build, behind an abortable 1500ms MCP deadline (entity COUNT — not per-entity fan-out — was the unbounded flooding axis). Augmentation is one-shot per content hash (known debt: entity edges refresh only when content changes). The cascade now has **one review surface**: show-affected scroll/pulses to `CascadeList`, status-gated via `showAffectedMode` — no parallel cascade presentation remains.

### 3.3 Evidence-Gated Severity (Precision-First Discipline)
A cascade that cries wolf is worse than no cascade, so every cascade proposal is evidence-gated and severity-ranked:
* **Citation required:** Each proposal must carry `CascadeEvidence` (`{sourceBlockId, quotedText, edgeType}`), and the `quotedText` is verified **verbatim against the live document** before the proposal is surfaced. A proposal with no locatable citation can never be `must`.
* **Severity is DERIVED, never trusted:** `deriveSeverity` in `orchestrator.ts` computes `CascadeSeverity` (`must`/`probably`/`optional`) from graph structure + `hasVerbatimConflict` (changed-token overlap via `extractChangedTokens`, with a stopword filter and 2-char number floor). The model's self-reported severity is ignored. Known limit: this verifies the citation EXISTS, not that it is semantically RELEVANT.
* **Relevance-judge stage (Cascade v2 Wave A — PR #5, merged):** the existence-vs-relevance gap is closed by a batched LLM judge (`src/lib/ai/relevanceJudge.ts`) that verifies `must`-candidates' citations GENUINELY conflict, with target block context in its input. Trust boundary rules: the judge can only LOWER severity, never raise it; its prompt contains no severity vocabulary (so it cannot parrot labels); and **malfunction preserves** — a thrown call OR a zero-valid-verdict response is a protocol malfunction that leaves the derived severities intact; only real per-candidate verdicts demote. "The judge failed to answer" is never read as "the judge denied." `maxTokens` scales with the candidate count (a fixed limit silently truncates the batch tail into wrong semantics); duplicate verdict indexes resolve deny-wins. The judge runs on a pinned utility model (`pickUtilityModel` → `claude-haiku-4-5`, claude provider only) — cheap housekeeping model for verification, user's model for recall (graph extraction).
* **UI contract:** All three review surfaces (`ProposedEditControl`, `CascadeList`, `SemanticCommitModal`) sort and visually distinguish severity; accept-all affordances default to `must`+`probably` with `optional` pre-toggled off. `normalizeProposedEdit()` backfills severity/evidence on legacy persisted edits during store rehydration.
* **Regression gate:** the EditPropBench-grounded harness (`src/lib/graphrag/__tests__/editPropBench.*`, labels per arXiv:2605.02083) gates recall ≥ 0.9, zero protected-unchanged violations, and 100% citation validity on every `npm run test`. (The "LEDGER agentic editing" paper is a known-fabricated citation — never cite it.)

### 3.4 Structured-Call Testability Seam
`src/lib/ai/structuredClient.ts` defines an injectable `CallStructuredFn`: graph building and cascade logic take the structured-call function as a parameter, so the eval harness and unit tests script the "model" deterministically. `fetchStructured` (the production implementation) THROWS on `!res.ok` — an empty `toolCalls` array means "the model found nothing", while provider failure raises; conflating them would poison the content-hash cache with an empty graph. `embedEdges.ts` follows the same discipline via its transient-throw / permanent-null contract.

### 3.5 Flow-State Reveal Flags (Event Segmentation, Redesigned — Wave C, PR #11)
The PRD requires cascade flags to be buffered until natural reading breakpoints. The load-bearing design rule, learned the hard way: **flow-state holds suppress PRESENTATION, never EXISTENCE.**
* Reveal flags live INSIDE `proposedChangePlugin`. Held cascades remain in plugin state with their anchors position-mapped through every intervening transaction; only their DECORATIONS are suppressed until the breakpoint reveals them.
* The rejected first design withheld held edits from the plugin entirely — which hard-broke apply, because withheld edits' anchors were never mapped. The plugin is the apply-time source of truth and must always contain every edit, revealed or not.

### 3.6 Re-Anchoring Rule: Validate-Stored-First (Wave C, PR #11)
When re-anchoring a proposal to the live document: **validate the stored range FIRST; fingerprint search is recovery, not truth.** Fingerprint-first re-anchoring silently RELOCATED valid blockId-less anchors to lookalike text elsewhere in the document. Order of trust: stored range (verify its text still matches) → blockId-scoped search → neighborhood-gated fingerprint search. Known debt: pure-insertion edits carry no target text and bypass fingerprint validation (documented in-code).

### 3.7 Telemetry Privacy Pattern (`cascadeCalibration` — Wave D, PR #12)
Calibration telemetry (does derived severity match user decisions?) follows a strict privacy contract:
* **Closed enums, metadata only:** events carry enum values and counts — never document text, never free-form strings.
* **Local-always, remote-opt-in:** the local aggregate is always maintained; PostHog capture is opt-in with **default FALSE**.
* **Buffer-flush-on-confirm:** modal accept/reject decisions are buffered and flushed only when the user CONFIRMS the modal — a cancelled review emits nothing.
* **`applied` only after successful apply:** the applied event is recorded post-apply, never optimistically.
* **Feedback loop:** a miscalibration hint surfaces only at n≥5 observations — no hinting off noise.

---

## 4. Multi-Agent Debating System (MADS)
LLMs exhibit "sycophancy" (agreeing with the user's false premises) and "disagreement collapse" (abandoning correct logic to reach consensus). To prevent automation bias, `edit`-type intents MUST be routed through a LangGraph debate. `ask`/`dig` use single-agent. `flag` uses LLM-classified complexity to decide routing.

### 4.1 Agent Personas & Orchestration
1. **The Troublemaker (Level 1 Sycophancy):** Prompted strictly to be a skeptic and dissident. Its role is to query the Knowledge Graph for edge cases, find contradictions, and challenge the user's intent. 
2. **The Peacemaker (Level 5 Sycophancy):** Prompted to synthesize the user's intent with the Troublemaker's constraints, finding a safe, compliant compromise.
3. **The Judge:** Evaluates the debate, verifies factual consistency using the `Ref(p)` core reasoning paths from the Knowledge Graph, and formats the final Semantic Commit.

### 4.2 Interaction Output
The debate is not hidden. The Judge's synthesis is returned to the frontend inside a collapsible `<Reasoning>` component. Unresolved tensions are surfaced to the user as **Provocations** via `extractProvocation()` in `mads.ts`. Provocations appear as: (1) inline amber callouts on AnnotationCard with a "Tell me more" button, and (2) gated apply friction in SemanticCommitModal requiring explicit user acknowledgment before Apply enables.

---

## 4.5 Annotation Type System (4-Intent Model)
The annotation system uses 4 intent types, consolidated from the original 6:

| Type | Color | Routing | Description |
|------|-------|---------|-------------|
| `ask` | Blue | Single-agent | Questions about the text — seeking explanation or clarification |
| `edit` | Red | MADS (complex) | Change requests — fix, correct, restructure, rewrite |
| `dig` | Purple | Single-agent | Deep exploration — research, compare, investigate |
| `flag` | Amber | LLM-classified | Observations, concerns, bookmarks — may or may not need action |

### Classification Flow
1. User highlights text and types/speaks naturally (no upfront type selection).
2. AI classifies into one of 4 types via `classifier.ts` using the `CLASSIFICATION_PROMPT`.
3. Result card shows a colored badge indicating the classified type.
4. User can click the badge to override:
   - **Non-mutating overrides** (ask<->dig, dig<->flag): Relabel only, no re-resolution.
   - **Mutating overrides** (anything<->edit): Re-run resolution via `streamResolveAnnotation` (because edit routes through MADS).

### Legacy Migration
* `LegacyAnnotationType` = `'question' | 'fix' | 'correction' | 'restructure' | 'explore' | 'thought'`
* `mapLegacyType()` maps: question->ask, fix/correction/restructure->edit, explore->dig, thought->flag
* `migrateAnnotations()` runs on store rehydration to transparently upgrade persisted data.

---

## 5. Prompt Context Assembly Strategy
Every agent invocation must receive a highly structured Context Package. The context window is assembled in this strict priority order:

1. **The Selection:** The exact text the user highlighted.
2. **The Local Block:** The surrounding paragraph/section (for immediate context).
3. **Session Context (Graph Subgraph):** The most relevant canonical entities, facts, and user preferences retrieved from the Graphiti memory layer.
4. **Semantic Refs:** Other document chunks sharing identical structural nodes.
5. **Argument Chain:** The direct dependency traversal (Multi-hop path: `e1 -> r1 -> e2 -> r2 -> e3`).
6. **Generation Context:** (If applicable) The original prompt that generated the document.

---

## 6. Document Persistence Pattern (Local-First)
* **Flat Document Hub:** `documentStore.ts` replaces the project-folder model. Documents are stored as a flat list with `id`, `title`, `createdAt`, `updatedAt`, and content hash. No folder hierarchy.
* **Content Storage:** ProseMirror document JSON serialized to localStorage under `intent-ide-doc:{id}` keys. Metadata stored in the Zustand-persisted store (`intent-ide-documents`).
* **Auto-Save:** 5-second debounce on ProseMirror `docChanged` transactions. `isDirty` flag tracks unsaved state. `beforeunload` event warns users.
* **Document Lifecycle:** EditorShell restores `activeDocumentId` on mount. AppShell shows DocInputModal only when no active document exists. All import paths (paste, file upload, URL) save to documentStore.
* **Backward Compat:** `projectStore.ts` remains but is no longer the primary persistence layer.

### Document Version History (git-model, Cascade v2 Wave E — PR #6 pending merge)
The "Git-style version control masked from the user" promise in §2 is now a real commit DAG (`DocCommit` in Prisma, `src/lib/history/`, append-only `/api/history`, `HistoryPanel.tsx`).

* **Two-level hash design (git's tree+commit split):** `contentHash` = sha256(canonical docJson) identifies the SNAPSHOT (`canonical.ts` provides deterministic serialization); the commit `hash` covers documentId + parentHash + contentHash + kind + message + actor + annotationId + auditIds + modelVersion and identifies the EVENT.
* **WHY attribution lives inside the commit hash:** adversarial review proved that content-only addressing silently merges commits that agree on WHAT the document says but disagree on WHO changed it and WHY — concretely, a racing 'direct' autosave landing on the same content absorbed an 'apply' commit's AI provenance. For an EU AI Act Article 12 ledger, provenance loss is corruption even when the bytes match, so attribution is part of the address (exactly git's own commit-object design: same tree, different author/message ⇒ different commit).
* **Server-verified, append-only DAG:** `/api/history` is POST create-only; the server recomputes BOTH hashes and rejects mismatches (400); a 409 stale-head check enforces linear history per document, with the client rebasing and retrying once; duplicate submissions are idempotent; there are no update/delete paths. Honest posture (see `docs/compliance.md`): application-enforced append-only, tamper-EVIDENT, not immutable; attribution is client-supplied.
* **Transactional restore ordering (durable-record-first):** `restoreCommit` runs: flush pending edits → write the HUMAN_RESTORE audit event → create the restore commit with that audit id embedded in its `auditIds` → ONLY THEN dispatch the editor `replaceWith` (`addToHistory: false`). The UI mutates only after the durable record exists — otherwise a failed write produces a success toast that lies. Restore is Confirmation-gated (HITL).
* **Capture-point granularity (three kinds):** `'import'` — root commit at document creation; `'apply'` — one commit per accepted resolution, carrying `blockIdsTouched`, `auditIds`, actor `ai+human`, `modelVersion`, and back-linked via `ChangeSet.commitHash`; `'direct'` — human typing, committed at flush boundaries (autosave debounce, doc-switch, unmount), deduped by `contentHash` in the kind-aware `createCommit`. `blameBlock` answers "last changed by" per block.
* **Editor integration rule:** `changeTrackingPlugin` skips `addToHistory: false` transactions, so restore/doc-switch `replaceWith` dispatches never fabricate phantom full-doc "Direct edit" entries.
* **User-facing language:** the UI never says commit/DAG/hash — only Version, Compare, Restore, "Last changed by" (HistoryPanel + AppShell History tab; pagination past 200 versions).

### Recursive Drilling (Paragraph-Level Interaction)
* **Interactive AgentMarkdown:** When `interactive=true`, the `AgentMarkdown` component splits rendered markdown into paragraph-level clickable blocks. Each block has hover highlight and a "click to drill" hint.
* **DrillMenu:** Positioned at the click point (not anchored to the element). Offers 3 actions that map to annotation types: "Dig deeper" (dig), "What's this mean?" (ask), "Edit this" (edit).
* **Child Annotation Linking:** Drill actions create child annotations via `createAnnotationFromText` using the parent's anchor positions. Children linked to parents via `parentId`/`childIds` on the Annotation interface.
* **Paragraph-level, not sentence-level:** This granularity is native to the markdown AST and avoids fragile sentence splitting.

### Response Verbosity Control
* **Per-annotation verbosity:** `Verbosity = 'concise' | 'normal' | 'detailed'` on each Annotation. Default is `normal`.
* **Multiplier pattern:** `VERBOSITY_MULTIPLIER` (0.5x / 1x / 2x) scales token limits. `VERBOSITY_INSTRUCTIONS` appends directive text to prompts. Both centralized in `resolver.ts`.
* **Applied in:** `resolveAnnotation`, `streamResolveAnnotation`, and `continueThread`.
* **UI:** Short/Normal/Long toggle buttons on `AnnotationCard.tsx`. Regenerate button appears only when verbosity deviates from `normal`.

### Annotation Sidebar Map
* **`AnnotationMap.tsx`:** Vertical minimap with colored dots per annotation at proportional document position. Type legend with counts.
* **Interaction:** Click dot scrolls editor to annotation and activates it.
* **View toggle:** `AnnotationPanel.tsx` header has list/map toggle. Map is a derived view of existing annotation state (no new stores).

### Positive Friction (Gated Apply + Inline Provocations)
* **MADS Provocation Extraction:** `extractProvocation()` in `mads.ts` parses the CHALLENGES section of MADS debate output and selects the strongest Troublemaker objection. Only fires on MODIFY or REJECT verdicts (APPROVE means concerns were addressed). Returns `null` when no actionable provocation found.
* **Resolution Interface:** `provocation?: string | null` and `usedMADS?: boolean` fields on the Resolution interface in `types.ts`. Set by MADS during resolution.
* **Inline Provocation Callout:** `AnnotationCard.tsx` shows an amber-bordered callout when `resolution.provocation` exists. Includes a "Tell me more" button that triggers a follow-up conversation about the concern.
* **Gated Apply:** `SemanticCommitModal.tsx` accepts `provocation` and `isHighRisk` props. When `isHighRisk=true` (usedMADS=true and provocation exists), the Apply button is disabled until the user clicks "I've considered this -- proceed". This prevents automation bias on high-risk AI-generated edits.
* **Conditional friction:** Low-risk edits (single-agent, no provocation) are NOT gated. The friction is proportional to the risk. This keeps the UX lightweight for simple cases while adding safeguards for complex ones.

---

## 7. Frontend Execution Patterns (React / UI)
* **Plan/Act Separation (Semantic Commits):** The UI must rigidly separate *Impact Analysis* (Retrieval) from *Generation*. Users must be shown the GraphRAG blast radius (split-canvas diff) before hitting "Apply". 
* **Token-Level Uncertainty:** Instead of generic confidence scores, leverage the model's `logprobs`. Calculate entropy at the token level and use a `<span>` wrapper to highlight specific words in yellow/red where the model is uncertain. This guides human review.
* **Breakpoint Buffering:** Cascade flags are only REVEALED at coarse reading breakpoints, preventing mid-sentence cognitive interruptions — implemented as reveal flags inside `proposedChangePlugin` (see §3.5): held items stay in plugin state with mapped anchors; only their decorations are suppressed. Do not implement buffering by withholding items from the plugin.

---

## 8. Multi-Agent Swarm Configuration
The project uses a swarm-style multi-agent coordination model defined in `AGENTS.md`:
* **10 Roles:** Orchestrator, Product Manager, Architect, UI-UX Specialist, Optimizer, Troublemaker, Judge, Security Auditor, QA, DevOps, Code Librarian.
* **Workflow Protocol:** New task -> Orchestrator reads plan + memory bank -> Route to PM (if ambiguous) or Architect (if clear) -> Execute -> QA + Troublemaker review -> DevOps build verify -> Code Librarian updates memory bank.
* **Role Boundaries:** Agents do not cross boundaries (e.g., Architect does not write feature code, Optimizer does not build new features).
* **Tool Mapping:** Each agent maps to a Claude Code subagent type for routing.

---

## 9. EU AI Act Compliance & Audit Infrastructure
The architecture must inherently satisfy Article 12 (Record-Keeping) and Article 14 (Human Oversight) of the EU AI Act.
* **Immutable Logging Schema:** Every Semantic Commit transaction must write to an audit log table capturing: 
  * `Timestamp_UTC`
  * `User_ID`
  * `Model_Version`
  * `Prompt_Hash` (The exact Context Package used)
  * `Retrieved_Graph_Nodes` (For traceability)
  * `Human_Override_Status` (Did the user click Apply, Tweak, or Reject?)
* **Human-in-the-Loop (HITL) Gates:** `innerHTML` or automated direct-writes to the DOM without user consent are strictly forbidden. All global changes must pass through a `<Confirmation>` UI gate.
