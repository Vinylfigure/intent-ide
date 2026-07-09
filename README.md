# Intent IDE

**Voice-first AI document review — semantic commits instead of full-document regeneration.**

[![CI](https://github.com/Vinylfigure/intent-ide/actions/workflows/ci.yml/badge.svg)](https://github.com/Vinylfigure/intent-ide/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![Next.js 14](https://img.shields.io/badge/Next.js-14-black)

AI can one-shot a document that's 90% right. The unsolved problem is the last 10%: today's tools force you to re-prompt and regenerate the whole thing, destroying the 90% you already liked. Intent IDE treats review as the product — you read, you react (by voice or text), and scoped AI agents make **targeted, auditable, human-approved edits** without touching anything else.

<!-- screenshot: main editor with annotations panel -->
<!-- screenshot: multi-region cascade review with inline accept/reject -->
<!-- screenshot: semantic commit modal with per-change diff toggles -->

## How it works

1. **Read and react.** Select text and type — or tap `Ctrl+Space` and speak (tap again to stop). No command syntax, no intent picker: an LLM classifies each annotation into one of four intents (`ask` / `edit` / `dig` / `flag`) behind the scenes, with a one-click override if it guesses wrong.
2. **A scoped sub-agent resolves it.** Every annotation dispatches an agent constrained to the selection's scope. High-risk `edit` annotations route through a **multi-agent debate** (MADS): a skeptical *Troublemaker* attacks the proposal, a *Peacemaker* synthesizes, and a *Judge* renders a verdict — specifically to counteract LLM sycophancy ("you're right, I'll change it" when you were wrong).
3. **Changes are reviewed, never auto-applied.** Proposed edits render as called-out regions in the editor, aware of your **read-line** (changes above where you've read are flagged loudly; changes below arrive quietly). Multi-region edits go through a commit modal with per-change diffs and accept/reject toggles. Nothing global applies without an explicit human decision.
4. **Everything is audited.** Every AI action writes an append-only audit record — model version, prompt hash, source documents, confidence, approval status — extending the spec's 14-field minimum schema, aligned with EU AI Act Articles 12 & 14 — see [docs/specs/compliance-audit-layer.md](docs/specs/compliance-audit-layer.md).

## Feature highlights

- **Invisible intent classification** — natural language in, structured intent out; users never fill in a form to leave a note
- **Voice pipeline** — record → Whisper transcription → classification → agent dispatch, in one gesture
- **Multi-Agent Debate System (MADS)** — Troublemaker/Peacemaker/Judge debate for high-risk edits, with the strongest unresolved objection surfaced as an inline "provocation" callout and a friction gate on Apply
- **Multi-region cascade edits** — when an edit has downstream consequences, a GraphRAG-backed cascade check proposes coordinated edits across the document; each region gets inline Accept/Reject, a navigable list, and a batched, validate-or-abort apply
- **Read-line awareness** — the editor tracks your reading position and buffers notifications to natural breakpoints (event segmentation), instead of yanking your attention mid-sentence
- **Structured tool-calling** — agents emit edits through a provider-agnostic `propose_edit` tool (`/api/structured`), not regex-parsed prose
- **Annotation threads, drilling, and verbosity control** — follow-up conversations per annotation, paragraph-level drill-down into AI responses, per-annotation response length (concise/normal/detailed)
- **Annotation minimap** — spatial overview of every annotation in the document, click-to-scroll
- **BYOK, local-first** — bring your own Anthropic/OpenAI-compatible/Ollama keys; documents persist locally; the audit ledger is SQLite via Prisma

## Architecture

```
src/app/              Next.js App Router pages + API routes
  api/                classify | resolve | generate | structured | transcribe | audit
src/components/       React components by feature
  Editor/             ProseMirror shell, commit modal, proposed-edit controls, toolbar
  Annotations/        cards, threads, cascade list, minimap, resolution actions
  Changes/            grouped change-sets, line-numbered diffs
  Voice/ DocInput/ Layout/ Settings/ ui/
src/lib/
  prosemirror/        schema, plugins (annotation, read-line, change tracking,
                      proposed changes, conflict, uncertainty), validate-or-abort apply
  ai/                 resolver, classifier, MADS state machine, cascade orchestrator,
                      prompts, model capability gates
  graphrag/ mcp/      FalkorDB + Graphiti knowledge-graph cascade checks (via MCP)
  voice/              recording + transcription pipeline
  annotations/ changes/ audit/ docInput/ utils/
src/stores/           Zustand stores (persisted, quota-hardened, with legacy migrations)
prisma/               append-only audit schema (SQLite)
mcp_server/           Graphiti MCP server (Python) for the knowledge graph
docs/specs/           design specs: compliance audit layer, GraphRAG architecture,
                      semantic commits UI
```

Engineering details a reviewer might care about:

- **ProseMirror plugin system** — each concern (annotations, read-line, change tracking, proposed changes, conflicts, uncertainty) is an isolated plugin with a `PluginKey`, typed state, and decorations remapped through `tr.mapping` on every transaction
- **One source of truth for review state** — per-edit accept/reject status lives in exactly one place (the proposed-change plugin); the inline controls, cascade list, and commit modal all read it, and only the batched apply mutates the document
- **Validate-or-abort apply** — multi-region edits are fingerprint-validated against live document text and applied in a single descending transaction, so stale positions abort instead of corrupting
- **Model capability gating** — `modelRejectsSampling()` centralizes per-model API quirks (newer Claude models reject `temperature`), so routes never hand-roll compatibility logic
- **Hardened persistence** — persisted Zustand stores use `partialize` caps, quota-error handling with emergency pruning, and rehydration migrations for legacy data shapes

## AI-augmented development

This project is both an AI product and an experiment in AI-augmented engineering process, kept deliberately in the open:

- [`.claude/agents/`](.claude/agents) — eight specialized agent roles (orchestrator, architect, troublemaker, judge, QA, code librarian, UI/UX, devops) with strict boundaries; the adversarial *troublemaker* role caught six real bugs before release
- [`.claude/skills/`](.claude/skills) — reusable task recipes (add a ProseMirror plugin, add an API route, scaffold a cascade edit) that encode the codebase's conventions
- [`memory-bank/`](memory-bank) — persistent project memory across AI sessions: [audit ledger](memory-bank/audit.md) of every architectural decision with human-approval records, [changelog](memory-bank/changelog.md), [progress tracker](memory-bank/progress.md), and distilled [system patterns](memory-bank/systemPatterns.md). (Session-scratch files — the active context window and raw reflection log — are local-only and created fresh on first session.)
- [`docs/specs/`](docs/specs) — the design specs the agents build against
- [`docs/compliance.md`](docs/compliance.md) — EU AI Act compliance statement (Articles 12 & 14): an append-only, hash-verified (tamper-evident) version history linked to the audit trail, with human-gated restores

The same human-in-the-loop discipline the product enforces on document edits was applied to building it: agents propose, tests and adversarial review interrogate, a human approves.

## Getting started

Requires Node 20+.

```bash
git clone https://github.com/Vinylfigure/intent-ide.git
cd intent-ide
npm install
cp .env.example .env       # fill in values (see below)
npx prisma generate
npm run dev                # http://localhost:3000
```

Then open **Settings → API Keys** in the app and add your own key (Anthropic by default; OpenAI-compatible endpoints and Ollama also supported). Keys are stored locally in your browser and sent per-request — there is no server-side key storage. One caveat: voice transcription is backed by OpenAI's Whisper API, so the voice feature specifically requires an OpenAI key; everything else works with a single provider of your choice.

**Optional — knowledge-graph cascade checks** (FalkorDB + Graphiti):

```bash
docker compose up -d                          # FalkorDB on :6379
cd mcp_server
pip install -r requirements.txt
python graphiti_mcp_server.py                 # MCP server on :8000
```

Without the graph stack, cascade checks fall back to keyword matching; everything else works.

## Testing

```bash
npm run test         # Vitest — 194 unit tests (prompts, stores, migrations, model gates)
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint (next/core-web-vitals)
npx playwright test  # optional e2e (needs dev server; graph tests skip without FalkorDB)
```

CI runs typecheck, lint, unit tests, and a production build on every push.

## License

[MIT](LICENSE)
