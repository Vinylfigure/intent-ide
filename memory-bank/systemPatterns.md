# System Patterns: Intent IDE (v8.4 candidate)

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
2. **Graph build:** Nodes = blocks keyed by `blockId`; edges = typed relations (`CascadeEdgeType`: defines/references/depends-on/implements/tests/contradicts/duplicates) with `DocGraphEdgeSource = 'deterministic' | 'llm' | 'graphiti'`. Deterministic extractors (cross-refs→headings, defined terms, duplicated sentences) always run; ONE validated `link_blocks` LLM pass runs per content hash, capped at 200 textblocks. FNV-1a `contentHash` keys an LRU-8 cache with inflight dedupe.
3. **Egress boundary:** `scheduleDocGraphRebuild` (background, on typing) is deterministic-only — document text never leaves the machine as a side effect of typing. The LLM pass runs lazily inside the user-initiated cascade.
4. **Traversal:** `getNeighborhood` BFS from the primary edit's block, 2 hops, ≤24 candidate blocks (block COUNT is capped; block text is never truncated — the old `.slice(0, 6000)` whole-doc truncation is deleted).
5. **Proposal:** The model sees only neighbor blocks (`blockId` + text) and returns `propose_edit` tool calls. Anchoring is blockId-first (`blockTextRange`) with a neighborhood-gated `findTextInDoc` fallback; overlapping/duplicate targets are dropped first-proposal-wins. All proposals flow into the existing HITL review surfaces and the validate-or-abort single-transaction apply.

**Lane B — Graphiti entity graph (read-only, unchanged):** `graphrag/cascadeCheck.ts` still maps entity mentions to read-only conflict decorations. Deliberately untouched in v8.4; `DocGraphEdgeSource` reserves `'graphiti'` for a future bridge that feeds entity edges into the docGraph.

### 3.3 Evidence-Gated Severity (Precision-First Discipline)
A cascade that cries wolf is worse than no cascade, so every cascade proposal is evidence-gated and severity-ranked:
* **Citation required:** Each proposal must carry `CascadeEvidence` (`{sourceBlockId, quotedText, edgeType}`), and the `quotedText` is verified **verbatim against the live document** before the proposal is surfaced. A proposal with no locatable citation can never be `must`.
* **Severity is DERIVED, never trusted:** `deriveSeverity` in `orchestrator.ts` computes `CascadeSeverity` (`must`/`probably`/`optional`) from graph structure + `hasVerbatimConflict` (changed-token overlap via `extractChangedTokens`, with a stopword filter and 2-char number floor). The model's self-reported severity is ignored. Known limit: this verifies the citation EXISTS, not that it is semantically RELEVANT.
* **UI contract:** All three review surfaces (`ProposedEditControl`, `CascadeList`, `SemanticCommitModal`) sort and visually distinguish severity; accept-all affordances default to `must`+`probably` with `optional` pre-toggled off. `normalizeProposedEdit()` backfills severity/evidence on legacy persisted edits during store rehydration.
* **Regression gate:** the EditPropBench-grounded harness (`src/lib/graphrag/__tests__/editPropBench.*`, labels per arXiv:2605.02083) gates recall ≥ 0.9, zero protected-unchanged violations, and 100% citation validity on every `npm run test`. (The "LEDGER agentic editing" paper is a known-fabricated citation — never cite it.)

### 3.4 Structured-Call Testability Seam
`src/lib/ai/structuredClient.ts` defines an injectable `CallStructuredFn`: graph building and cascade logic take the structured-call function as a parameter, so the eval harness and unit tests script the "model" deterministically. `fetchStructured` (the production implementation) THROWS on `!res.ok` — an empty `toolCalls` array means "the model found nothing", while provider failure raises; conflating them would poison the content-hash cache with an empty graph.

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
* **Breakpoint Buffering:** Background cascade flags must be stored in a Zustand state array and ONLY rendered to the DOM when the user's scroll position hits a "coarse breakpoint" (e.g., a section header), preventing mid-sentence cognitive interruptions.

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
