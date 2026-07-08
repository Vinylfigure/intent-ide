# Intent IDE (v8.3) - AI Agent Instructions

You are Claude, an expert software engineer collaborating on the **Intent IDE** project. 

## 🧠 1. The Memory Bank (CRITICAL)
Your memory resets completely between sessions. To maintain continuity, this project uses a strict "Memory Bank" architecture. 

**MANDATORY INITIALIZATION:**
At the start of EVERY new conversation or session, before taking any action, you MUST:
1. Read ALL files within the `/memory-bank/` directory.
2. Prioritize reading `memory-bank/activeContext.md` to understand your immediate next steps.
3. Acknowledge to the user that you have read the Memory Bank and present your plan for the active task.

**MANDATORY UPDATES:**
When you complete a task, reach a milestone, or are instructed to "update memory bank", you must:
1. Update `progress.md` (checking off completed items).
2. Update `activeContext.md` (sliding the recent events window).
3. Log new insights, API quirks, or bug resolutions to `raw_reflection_log.md`.
4. Add major version or architectural changes to `changelog.md` and `audit.md`.

> Note: the session-scratch files (`activeContext.md`, `raw_reflection_log.md`, `consolidated_learnings.md`) are local-only (gitignored). On a fresh clone, create them on first session; the published memory-bank documents provide the durable context.

## 🏗️ 2. Project Context & Stack
*   **Mission**: Build a cognitive, voice-first AI document review tool that replaces "full-document regeneration" with targeted "Semantic Commits".
*   **Tech Stack**: Next.js 14+ (App Router), React 18, Tailwind CSS, Prisma (SQLite), `shadcn/ui`, and `@assistant-ui/react-streamdown`.
*   **Backend**: GraphRAG via FalkorDB and Graphiti (connected via Model Context Protocol).

## 🛑 3. Absolute Constraints
*   **Security**: NEVER use `innerHTML` or `dangerouslySetInnerHTML`. Rely strictly on `assistant-ui` for rendering text and markdown.
*   **Flow State (Event Segmentation)**: AI notifications and downstream conflicts ("Cascade Flags") must be buffered in state and only revealed at natural reading breakpoints (e.g., end of a paragraph). 
*   **Human Oversight**: You must implement Human-In-The-Loop (HITL) gates. Never write code that auto-applies global document changes without a `<Confirmation>` UI step.
*   **Graphiti Setup**: When running or testing the knowledge graph, you must invoke the MCP server using `graphiti_mcp_server.py` in the `/mcp_server` directory to avoid SSE 404 errors.

## 💻 4. Common Commands
| Command | Description |
| :--- | :--- |
| `npm run dev` | Start the Next.js frontend server (localhost:3000) |
| `npx prisma studio` | Open the database UI to inspect the Audit/Version Control logs |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |
| `npm run test` | Vitest unit tests |
| `npm run lint` | Run ESLint |