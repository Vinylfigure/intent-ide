# Tech Context: Intent IDE (v7.0)

## 1. Frontend Ecosystem & Dependencies
The frontend is built on Next.js 14+ (App Router) and React 18+. The UI architecture strictly relies on the "Open Code" philosophy. AI agents MUST NOT introduce monolithic third-party component libraries (like Material UI).

### 1.1 Strict UI Stack
*   **Foundation:** Tailwind CSS, `lucide-react`, `clsx`, and `tailwind-merge`.
*   **Tier 1 Component Library (`shadcn/ui`):** All standard UI components MUST be installed via the `shadcn/ui` CLI to the `@/components/ui/` directory.
*   **Tier 2 AI Interface (`assistant-ui` & AI SDK):** All generative interfaces MUST be built using `assistant-ui` and Vercel AI SDK.
    *   Use `<Thread>`, `<Message>`, and `<ChainOfThought>` / `<Reasoning>` for multi-agent debate visibility.
    *   **Markdown Rendering:** MUST use `@assistant-ui/react-streamdown` and `@streamdown/code`. You must configure the `remend` property to auto-complete incomplete markdown syntax during live streaming to prevent UI flickering.
    *   **Attribution:** Use `<InlineCitation>` and `<Sources>` for visual RAG source attribution.

### 1.2 `package.json` Required Dependencies
```json
{
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.3.0",
    "ai": "^3.1.0",
    "@assistant-ui/react": "latest",
    "@assistant-ui/react-streamdown": "latest",
    "@streamdown/code": "latest",
    "zod": "^3.22.4"
  }
}

--------------------------------------------------------------------------------
2. Semantic Memory & GraphRAG Backend
The backend utilizes a temporal knowledge graph to enable "blast radius" detection (multi-hop reasoning) for Semantic Commits, bypassing the limitations of standard vector databases.
2.1 Graph Infrastructure & MCP Integration
Graph Database: FalkorDB (low-latency, OpenCypher support).
Graph Orchestration: Graphiti via the Model Context Protocol (MCP).
Crucial Server Configuration: When starting the MCP server, you MUST execute graphiti_mcp_server.py in the /mcp_server directory, NOT the standard REST API server in the /server directory (which will result in 404 SSE errors).
2.2 Graphiti DB Schema (OpenCypher)
The agent MUST adhere to this entity-relationship schema when writing extraction prompts:
Nodes: Entity (name, entity_type, summary) and Episode (name, content, timestamp, source, invalid_at).
Edges: RELATES_TO (connects entities), MENTIONED_IN (links entities to episodes), OCCURRED_AFTER (temporal sequence).

--------------------------------------------------------------------------------
3. Relational Database Schema (Compliance Layer)
To satisfy EU AI Act Articles 12 & 14, all state changes and Semantic Commits MUST be logged immutably. Use PostgreSQL via Prisma or local SQLite.
3.1 Audit & Version Control Schema (Prisma)
model DocumentSource {
  id           String       @id @default(uuid())
  content      String       // The base document text
  version      Int          @default(1)
  updatedAt    DateTime     @updatedAt
  annotations  Annotation[]
}

model Annotation {
  id           String       @id @default(uuid())
  sourceId     String
  source       DocumentSource @relation(fields: [sourceId], references: [id])
  transcript   String       // User's voice/text input
  intentType   String       // "QUESTION", "FIX", "EXPLORE", "THOUGHT", "CORRECTION", "RESTRUCTURE"
  scopeStart   Int          // Character selection boundary
  scopeEnd     Int
  resolutions  Resolution[]
}

model Resolution {
  id               String       @id @default(uuid())
  annotationId     String
  annotation       Annotation   @relation(fields: [annotationId], references: [id])
  semanticCommit   String       // The AI's proposed textual change
  reasoningChain   Json         // MADS debate summary for <Reasoning> block
  uncertaintyMap   Json         // Token-level entropy scores for UI highlighting
  approvalStatus   String       // "PENDING", "APPROVED", "REJECTED", "TWEAKED"
  auditLog         AuditLog?
}

// EU AI ACT ARTICLE 12 MANDATORY LOGGING
model AuditLog {
  id               String     @id @default(uuid())
  resolutionId     String     @unique
  resolution       Resolution @relation(fields: [resolutionId], references: [id])
  timestamp_UTC    DateTime   @default(now())
  userId           String     
  modelVersion     String     
  promptHash       String     // Hash of the Context Package used
  graphNodesUsed   String[]   // Array of Graphiti node IDs retrieved
}

--------------------------------------------------------------------------------
4. State Management & Orchestration (LangGraph)
Complex annotations (Correction, Fix, Restructure) MUST be routed through a Multi-Agent Debating System (MADS) orchestrated by LangGraph.
4.1 Token-Level Uncertainty Calculation
For the uncertaintyMap in the database, the backend MUST extract logprobs from the LLM response.
Entropy Calculation: Calculate token-level entropy using the formula: Uncertainty = -Σ (p * log(p)) across the top-k tokens at each generation step.
Frontend Mapping: Map high-entropy tokens to a yellow/red <span> wrapper in the UI to draw the user's attention to critical decision points.
4.2 Context Window & Token Management
The 50% Rule: The system MUST monitor context window usage. If the Session Context + Document chunks exceed 50% of the model's maximum context window, the system must trigger a summarization/compaction routine to prevent generation degradation.
Estimation: Use standard multipliers for estimation (Code: 2.8 chars/token, Markdown: 3.5 chars/token, Prose: 4.0 chars/token).

--------------------------------------------------------------------------------
5. Development Constraints & Agent Directives
When Claude Code, Cursor, or Windsurf operates on this repository, it MUST adhere strictly to these rules:
Cursor Rules (.mdc files): All architectural rules must be codified in .cursor/rules/*.mdc files using YAML frontmatter (e.g., description: and globs: ["*.tsx"]) to dynamically trigger context during development.
Safe DOM Manipulation: NEVER use innerHTML or dangerouslySetInnerHTML. Rely entirely on @assistant-ui/react-streamdown to prevent XSS vulnerabilities.
Human-in-the-loop (HITL) Enforcement: Do not write code that automatically overwrites the DocumentSource text. Every Resolution must be created with approvalStatus: "PENDING" and wait for the user to interact with the <Confirmation> component UI.
Task Handoff: For complex feature implementations, the AI agent must break tasks into 15-30 minute subtasks. If the AI's internal context window degrades, it must summarize its progress and use a new_task or handoff tool to start a fresh session before continuing.
