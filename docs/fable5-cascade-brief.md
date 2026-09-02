# Implementation Brief — Precision-First Cascade Graph (Intent IDE)

**For:** Fable 5, planning + execution.
**Status:** Ready to plan. This is a rebuild of the *existing* cascade, not a greenfield MVP.
**File is local/untracked** — `main` is branch-protected; ship the work as a PR (`gh pr create`).

---

## 0. How to use this brief

1. **Plan first.** Read the Memory Bank and the files in §3, then produce a plan (plan mode or `/plan-feature`) with an explicit "done means" per task. Get sign-off before writing code.
2. Execute **task by task, in order** (§5). Each task lands behind green `npm run typecheck && npm run lint && npm run test`. Do not batch all five into one change.
3. Prefer TDD for the graph and cascade logic — the eval harness (Task 5) is the spec; consider writing its fixtures early and letting them drive Tasks 2–3.
4. This brief describes the current state *as confirmed at authoring time*. **Verify each claim against the live files** before relying on it — the code is the source of truth.
5. When done, run the swarm agents (QA, Troublemaker, DevOps, Librarian) per the project's workflow rules, and update the Memory Bank.

---

## 1. Mission (context)

Intent IDE is a voice-first AI document-review tool. The user reads a document top-to-bottom, annotates as they go, and each annotation dispatches a scoped sub-agent that proposes a **targeted edit** — never a full-document regeneration. The differentiating primitive is **cascade**: when the user changes section A, the tool should find every *other* region that must change to stay consistent, and let the user review each change with human-in-the-loop gating.

**The cascade is the moat, and it is currently the most stubbed part of the system.** This brief fixes that.

## 2. Stack & commands

- Next.js 14 (App Router), React 18, TypeScript, ProseMirror (editor), Zustand (state), Tailwind + shadcn/ui, Prisma + SQLite (audit).
- BYOK LLM: Claude / OpenAI-compatible / Ollama, routed through `/api/structured` (provider-agnostic tool calling).
- Commands: `npm run dev` · `npm run typecheck` (`tsc --noEmit`) · `npm run lint` (`next lint`) · `npm run test` (`vitest run`) · `npm run build`.
- Tests live colocated in `__tests__/` dirs; `vitest.config.ts` at root; `vitest run` auto-discovers `*.test.ts(x)`.

## 3. Read these first (the current cascade)

| File | What it is |
|---|---|
| `src/lib/ai/orchestrator.ts` | `proposeCascadeEdits` — the whole-doc LLM cascade pass. **The core thing you are replacing.** |
| `src/lib/ai/resolver.ts` | `attachCascadeEdits` (~line 115). Note `docText…slice(0, 6000)` (~line 125). |
| `src/lib/prosemirror/applyProposedEdits.ts` | `findTextInDoc` (first-occurrence anchor) + `applyProposedEdits` (validate-or-abort, descending single transaction — **keep this safety**). |
| `src/lib/prosemirror/plugins/proposedChangePlugin.ts` | `ProposedAnchor` + `getProposedAnchors` — live, transaction-mapped anchors for pending edits. |
| `src/lib/annotations/types.ts` | `SuggestedEdit`, `ProposedEdit`, `ProposedEditRelation`, `ProposedEditStatus`, `Resolution`. |
| `src/app/api/structured/route.ts` | Provider-agnostic `{messages, tools}` → `{toolCalls}` endpoint. Respects `modelRejectsSampling`. |
| `src/lib/prosemirror/schema.ts` | Schema built via `OrderedMap` + `addListNodes`. **Where block IDs are added (Task 1).** |
| `src/lib/graphrag/cascadeCheck.ts` | The *other*, separate cascade path: Graphiti entity graph → read-only conflict decorations by entity-name string match. **Read it; see §4 and the open decision in §8.** |
| `src/components/Editor/ProposedEditControl.tsx`, `src/components/Annotations/SemanticCommitModal.tsx`, `src/components/Annotations/CascadeList.tsx` | The three review surfaces that must render severity (Task 4). |

## 4. The problem (why this rebuild exists)

There are **two disconnected cascade mechanisms, and neither is a real dependency graph:**

1. **`proposeCascadeEdits` (the editable path, wired into resolution):**
   - Sends the document to the model in **one whole-doc LLM pass** — no graph, no retrieval, no edges.
   - The doc is truncated to **6000 characters** (`resolver.ts` `.slice(0, 6000)`) ≈ 4 pages. **On a 20-page document, cascade never sees pages 5–20.** This silently breaks the headline use case.
   - Each returned region is anchored by `findTextInDoc` = **first exact substring match in a single text node.** If a phrase repeats (and consistent documents repeat terms *by definition*), it can anchor — and later apply — to the **wrong occurrence.** It also misses text spanning marks/nodes.

2. **`graphrag/cascadeCheck.ts` (the Graphiti path):**
   - Uses an **entity** knowledge graph, not a **document-dependency** graph. It flags **every case-insensitive mention of an entity name** (`findAllOccurrences`) as a conflict → false-positive firehose. Severity is a crude substring check.
   - Produces **read-only conflict decorations**, disconnected from the editable proposals.

3. **No stable block IDs anywhere.** Every anchor is string-matching. This is the root cause of the anchoring fragility in both paths.

## 5. Research grounding (use the RIGHT citation)

- ✅ **EditPropBench** (`arXiv:2605.02083`, May 2026) is the real, relevant benchmark. It operationalizes exactly this problem — *edit section A → propagate to every dependent downstream claim* — over manuscripts, using **a controlled fact graph with sentence-level labels: `direct-target` / `required-downstream-update` / `protected-unchanged`**, scored by an "Edit-Ripple Adherence" (ERA) metric. Frontier editors score a wide ERA range (far from solved). **Model the eval harness (Task 7) on this label taxonomy.** Read the abstract before citing any number in external material.
- ⛔ **"LEDGER: Scaling Agentic Document Editing with Dependency-aware Graph Retrieval" does not exist.** It was fabricated (the real `arXiv:2606.13100` "LEDGER" is an unrelated financial-KPI benchmark). **Do not search for it, cite it, or use its "76%/56%/85%" numbers anywhere.** If you see it referenced, treat it as a known-bad citation.

---

## 6. The goal

Replace the two stubs with **one precision-first document dependency graph** that:

- anchors on **stable block IDs**, not string matching;
- **scopes** cascade to a graph neighborhood (send the model only candidate blocks, not the whole doc) — removing the 6000-char truncation;
- makes every proposal **evidence-gated and severity-ranked** ("must" requires a cited conflicting region; "the model said so" is a lead, not a must);
- is **measured** by an EditPropBench-style eval harness that gates regressions.

Precision is the product. A cascade that cries wolf is worse than no cascade.

---

## 7. Deliverables (ordered; each behind green typecheck + lint + test)

### Task 1 — Stable block IDs
Give every **block-level** node (`paragraph`, `heading`, `blockquote`, `code_block`, `list_item`) a persistent `blockId` attr.
- Extend the node specs in `schema.ts` with `attrs: { blockId: { default: null } }`, and round-trip it through `toDOM`/`parseDOM` as `data-block-id` so it survives HTML/localStorage serialization.
- Add a ProseMirror plugin (`appendTransaction`) that **stamps a fresh `blockId` on any block node whose id is null or duplicated.**
- ⚠️ **The #1 gotcha:** splitting a node (pressing Enter mid-paragraph) **copies attrs**, so both halves inherit the same `blockId`. The plugin **must detect duplicate ids in a single transaction and reassign** so every block ends unique. Cover this with a test.
- Verify `blockId` survives the document persistence path (`documentStore` / `EditorShell` save+restore under `intent-ide-doc:{id}`). Existing saved docs have no ids → the plugin mints them on first load (acceptable; note it in the PR).

### Task 2 — Document dependency graph (`src/lib/graphrag/docGraph.ts`, new)
- **Nodes** = blocks, keyed by `blockId`. **Edges** = typed relations: `defines | references | depends-on | implements | tests | contradicts | duplicates`.
- Build edges from: (a) explicit cross-references ("see Section 4", heading links); (b) shared **defined terms** (term-definition patterns, repeated capitalized terms); (c) an **LLM extraction pass run once per document and cached** (key the cache by a content hash; rebuild only when the doc changes materially — debounce; do not rebuild per edit).
- This graph is the retrieval index cascade queries — **not** the raw document text.

### Task 3 — Graph-scoped cascade (replace the guts of `proposeCascadeEdits`)
- Resolve the primary edit's position → its `blockId` → traverse the graph to a **bounded N-hop neighborhood**; collect candidate blocks.
- Send the model **only the neighbor blocks** (with their `blockId`s and text), asking for one `propose_edit` per block that must change. **Remove the `.slice(0, 6000)` in `resolver.ts`** — the graph now bounds context.
- Anchor returned edits **by `blockId` first**, falling back to `findTextInDoc` only if a block can't be located. Keep the existing "skip anything overlapping the primary range" guard.

### Task 4 — Evidence-gated, severity-ranked proposals
- Extend `ProposedEdit` (additive — see §8 for exact shape) with `severity` and `evidence`.
- Every cascade proposal **must cite the specific region it reconciles**: the `sourceBlockId`, verbatim `quotedText` of the now-conflicting text, and the `edgeType` linking it to the primary edit. **A proposal with no locatable citation is not a "must" — downgrade to `optional` or drop it.** This is the false-positive gate.
- Severity: `must` = a cited hard contradiction (a figure/name/claim that now disagrees); `probably` = a cited dependency/shared-term edge; `optional` = stylistic. It maps onto EditPropBench's labels: `direct-target`+`required-downstream` → `must`; `protected-unchanged` → must-NOT-touch.
- The three review surfaces (`ProposedEditControl`, `SemanticCommitModal`, `CascadeList`) must **sort and visually distinguish** severity. The accept-all affordance defaults to `must` + `probably` only.

### Task 5 — EditPropBench-grounded eval harness (`src/lib/graphrag/__tests__/`, new)
- ≥8 fixtures shaped as `{ doc, primaryEdit, labels: { directTargets: blockId[], requiredDownstream: blockId[], protectedUnchanged: blockId[] } }`.
- A Vitest suite that runs the **real** cascade and reports: **recall** (of `requiredDownstream` hit), **precision / false-positive violations** (any `protectedUnchanged` touched), and **citation validity** (each proposal's `quotedText` actually exists at its `sourceBlockId` and genuinely conflicts).
- Wire into `npm run test`. This is the regression gate for all future cascade changes.
- *Optional north-star:* a runner that scores Intent IDE's cascade against the public EditPropBench dataset — real external validation. Note it as stretch.

---

## 8. Exact type changes (additive)

Current (`src/lib/annotations/types.ts`), confirmed at authoring time:

```ts
export type ProposedEditRelation = 'primary' | 'cascade'
export type ProposedEditStatus = 'pending' | 'accepted' | 'rejected'
export interface ProposedEdit {
  id: string
  from: number
  to: number
  newText: string
  reason: string
  relation: ProposedEditRelation
  status: ProposedEditStatus
  targetText: string
}
```

Target — extend, do not break existing fields:

```ts
export type EdgeType =
  | 'defines' | 'references' | 'depends-on'
  | 'implements' | 'tests' | 'contradicts' | 'duplicates'

export type ProposedEditSeverity = 'must' | 'probably' | 'optional'

export interface CascadeEvidence {
  sourceBlockId: string   // the block whose text now conflicts
  quotedText: string      // verbatim conflicting text (apply-time verifiable)
  edgeType: EdgeType      // graph edge linking it to the primary edit
}

export interface ProposedEdit {
  // ...all existing fields unchanged...
  blockId?: string                 // anchor of record (from Task 1)
  severity: ProposedEditSeverity   // required going forward; primary = 'must'
  evidence: CascadeEvidence | null // null ⇒ cannot be 'must'
}
```

The `propose_edit` tool schema (`orchestrator.ts`) gains `source_block_id`, `quoted_text`, and `edge_type`; severity is **derived** from the edge/contradiction, not blindly trusted from the model. New graph types (`BlockNode`, `DocGraph`, edge list) live in `docGraph.ts`.

## 9. Hard constraints (non-negotiable — from `CLAUDE.md`)

- **HITL preserved.** Nothing auto-applies. All multi-region edits still route through `SemanticCommitModal` with per-change accept/reject. Keep the single **validate-or-abort, descending-by-`from`, one-transaction** apply in `applyProposedEdits` — never apply a stale range.
- **No `innerHTML` / `dangerouslySetInnerHTML`.** Rendering stays via assistant-ui / Streamdown.
- **Provider-agnostic** through `/api/structured` (Claude / OpenAI / Ollama). Respect `modelRejectsSampling` (drop `temperature` for models that 400 on it).
- **Best-effort cascade.** A graph build or cascade failure must fall back to **primary edit only** and never block resolution (current `attachCascadeEdits` contract).
- **Evidence-gating discipline.** A proposal the model cannot ground in a citable source region is a *lead, not a must*. Do not surface leads as high-severity.

## 10. Acceptance criteria

- `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` all green.
- New eval suite passes; **precision, recall, and citation-validity are reported**.
- A **15+ page** document cascades correctly **past page 4** (proves `.slice` removal + graph scoping).
- A **repeated phrase** anchors to the **correct occurrence** via `blockId` (proves stable IDs fixed the first-occurrence bug).
- **Splitting a block** (Enter mid-paragraph) yields **two distinct `blockId`s** (proves the split-duplicate guard).
- Swarm agents run; Memory Bank updated.

## 11. Non-goals / do NOT

- Do **not** rebuild the MVP editor, annotation flow, voice pipeline, or MADS — they exist and work.
- Do **not** cite or search for the fabricated "LEDGER agentic editing" paper (§5).
- Do **not** weaken the apply-time safety (validate-or-abort single transaction).
- Do **not** port external scaffold code wholesale; only the *discipline* (evidence-gating) applies here.

## 12. Open decisions to surface during planning

1. **Unify or bridge the two cascade paths?** Should the Graphiti entity path (`cascadeCheck.ts`) feed the new `docGraph` (entities as an additional edge source), or stay a separate read-only lane? Propose a recommendation with tradeoffs before implementing.
2. **Graph rebuild trigger & cost.** When does the once-per-doc LLM extraction run — on open, on idle, on explicit action? What's the UX while it builds? Cascade must degrade gracefully (primary-only) if the graph isn't ready.
3. **`blockId` across copy/paste and undo.** Confirm behavior: pasted blocks get fresh ids; undo restores prior ids. Add tests for both.
4. **Severity derivation authority.** How much to trust the model's self-reported edge/severity vs. deriving it from graph structure + a verbatim-conflict check. Lean toward deriving.

---

*Grounded against the live codebase and a verified deep-research pass (EditPropBench confirmed real; LEDGER confirmed fabricated). Plan first, verify each task green, keep the human in the loop.*
