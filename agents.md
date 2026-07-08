# Intent IDE — Multi-Agent Swarm (Summary)

> **Authoritative source:** the runtime-executed agent definitions now live in **`.claude/agents/*.md`**. Those files are loaded and executed by the harness — this file is only a human-readable map. When in doubt, read `.claude/agents/`.

## Roles (one-line charters)

| Agent | File | Charter |
|---|---|---|
| Orchestrator | `.claude/agents/orchestrator.md` | Routes tasks to specialists and sequences the workflow; writes no feature code. |
| Architect | `.claude/agents/architect.md` | Produces the technical blueprint and component boundaries before any code. |
| Troublemaker | `.claude/agents/troublemaker.md` | Adversarial reviewer that hunts flaws and combats groupthink/sycophancy. |
| Judge | `.claude/agents/judge.md` | Arbitrates troublemaker-vs-developer disputes on architectural merit. |
| QA | `.claude/agents/qa.md` | Designs and runs edge-case/boundary tests; reports failures. |
| Code Librarian | `.claude/agents/code-librarian.md` | Owns the `memory-bank/`; updates it after every completed task. |
| UI/UX | `.claude/agents/ui-ux.md` | Presentation and accessibility only — no logic or state changes. |
| DevOps | `.claude/agents/devops.md` | Keeps the build green (typecheck/lint/test/build, deps, CI); no feature work. |

Supporting Claude Code subagent types still available: `product-manager`, `refactoring-optimizer`, `Explore`.

## Workflow Protocol (summary)

1. New task → Orchestrator reads the plan file and `memory-bank/activeContext.md`.
2. Ambiguous requirements → Product Manager for a PRD.
3. Clear requirements → Architect for a blueprint.
4. Blueprint approved → execution (prefer the `build-wave` skill for multi-file work; UI/UX for presentation).
5. Code written → QA for tests, then Troublemaker for adversarial review (run both after every wave, even unprompted).
6. Disagreement → Judge for a verdict.
7. Tests pass + review clean → DevOps for build verification.
8. Build green → Code Librarian updates the memory bank.

## Core Guardrails (all agents)

- **No XSS:** never `innerHTML` / `dangerouslySetInnerHTML`; render AI/markdown via assistant-ui / Streamdown.
- **HITL:** document/global changes never auto-apply — always gated through `SemanticCommitModal` / a `<Confirmation>` step.
- **Append-only audit:** the Prisma v7 + SQLite ledger logs old/new values; never mutate or delete entries.
- **Memory Bank:** read `memory-bank/activeContext.md` at session start (local-only/gitignored — create it on first session from a fresh clone); update after every completed task.
- **GraphRAG MCP:** boot via `graphiti_mcp_server.py` in `/mcp_server` (not standard REST).

## Stack

Next.js 14 App Router · React 18 · ProseMirror editor + custom plugins · Zustand stores persisted to localStorage · Prisma v7 + SQLite audit ledger · BYOK to Claude/OpenAI/Ollama via Next.js API routes.
