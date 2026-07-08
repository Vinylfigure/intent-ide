# Project Brief: Intent IDE (v8.3)

## 1. Project Identity & Core Thesis
**Project Name:** Intent IDE  
**Platform:** Web app (Next.js/React full surface) with browser extension (capture layer) [1].  
**Core Thesis:** AI is approaching the ability to one-shot most professional documents; it is often 90% right [1, 2]. The massive, unresolved bottleneck in modern workflows is how users review, adjust, and finalize what the AI generates without triggering a "full-document regeneration" that destroys the 90% they were already happy with [1, 3]. Large Language Models (LLMs) currently produce monolithic text that is hard to edit in parts, slowing down collaborative workflows [4].

**Mission:** Intent IDE transforms document review from a solution-generative activity into a solution-evaluative activity. It solves the regeneration bottleneck by decomposing monolithic AI outputs into manipulable, independently editable semantic units while preserving the author's original linguistic resonance [4].

---

## 2. Core Foundations (Non-Negotiables)
Every feature built into this system MUST adhere to the following principles. If a feature violates these, it must be rejected and redesigned.

### A. Edit As You Read (Incremental Updating)
Users do not read a whole document and then write a mega-prompt in a chat box. They edit each section as they hit it [5]. The document updates incrementally [5]. If a user is happy with 1,800 out of 2,000 words, those 1,800 words are NEVER re-generated [6].

### B. Scope-Locked Changes & Semantic Commits
When an AI agent modifies text, it must be strictly constrained to the declared scope boundary [7]. To accomplish this, the system implements **Semantic Commits** [8]. Users commit localized ideas, requirements, and details to the project document similar to how they commit code [8, 9]. Before a global change is applied, the AI must present the "blast radius" or conflict detection via a split-canvas UI, separating retrieval/analysis from generation [9].

### C. The Read-Line (Event Segmentation Theory)
The user's current reading position acts as a spatial, cognitive checkpoint [6]. Changes above the read-line get flagged; changes below are applied silently [6]. 
*   **Crucial Cognitive Rule:** To prevent severe context-switching penalties, the IDE must buffer downstream AI alerts (Cascade Flags) and only deliver them at "coarse breakpoints" (e.g., the end of a paragraph or section) rather than "fine breakpoints" (mid-sentence) [10].

### D. Version Control, Not Chat
The underlying data model is Git-style version control, ensuring European AI Act (Article 12 & 14) compliance through an immutable audit trail [11]. However, the user-facing language must be completely accessible (e.g., "Compare" instead of diff, "Pick and choose" instead of cherry-pick, "Change" instead of commit) [12-14].

### E. Every Annotation is Agentic
Nothing is "just a note" [15]. Every interaction type dispatches a specialized sub-agent:
1.  **Question:** Explains and provides context [15].
2.  **Fix:** Proposes scoped replacement [15].
3.  **Explore:** Researches and expands without auto-changing the doc [16].
4.  **Thought:** Researches the thought and checks implications across the document [16].
5.  **Correction:** Fact-checks the user, applies the fix, and flags downstream inconsistencies [17, 18].
6.  **Restructure:** Proposes reorganized scoped sections [17].

---

## 3. Technical Architecture Paradigms
The AI coding agent must utilize the following architectural paradigms to satisfy the product's requirements:

### A. GraphRAG & Temporal Context (via Graphiti)
Simple vector databases fail at multi-hop reasoning. To track the "blast radius" of user edits, Intent IDE relies on a Knowledge Graph architecture (e.g., Graphiti) [19, 20]. 
*   The system processes document chunks and user notes as `Episodes`, extracting them into a `Semantic Entity Subgraph` and clustering them into a `Community Subgraph` [20].
*   When a "Cascade Check" is triggered by an upstream edit, the system traverses explicit dependency chains in the graph to find semantic conflicts [21].

### B. Multi-Agent Debating System (MADS)
To prevent "Sycophancy" (where the AI blindly agrees with a user's incorrect correction), complex annotations must pass through a Multi-Agent Debate [22]. A "Troublemaker" agent configured to be highly skeptical critiques the task, while a "Peacemaker" agent synthesizes a safe, accurate resolution [22]. The resulting debate is shown in the UI via `<Reasoning>` blocks to enforce positive friction and human critical thinking.

### C. The Session Context
Everything the user learns, fixes, and thinks accumulates into a running `Session Context` compressed to ~500 tokens [5, 23]. This context is fed into every sub-agent prompt alongside the local block, semantic references, and argument chains [23, 24].

---

## 4. Developer & AI Directives (Rules of Engagement)
When writing code for this project, the AI assistant MUST strictly follow these behavioral protocols:

*   **Plan/Act Pattern:** The AI must separate planning from execution. It must present a clear plan (identifying files to touch and potential conflicts) and await user approval before writing code to prevent unintended system-wide changes [25, 26].
*   **The Baby Steps™ Methodology:** Break down every implementation task into the smallest possible meaningful change [27]. Focus on one substantive accomplishment at a time, complete it fully, validate incrementally via tests, and document the change [27].
*   **No Unsanitized InnerHTML:** For frontend generation, the AI MUST prioritize `.textContent` or safe React component patterns over dangerous innerHTML execution to maintain strict security [28]. 
*   **Update the Memory Bank:** If architectural decisions are made or new dependencies are added, the AI must autonomously request to update the `activeContext.md` and `systemPatterns.md` files [29]. 

---

## 5. Success Metrics & Non-Goals
**Success Metrics:**
*   Highlight to voice recording starts in < 1 second [30].
*   Focus anchor accuracy is ≥ 80% [30].
*   Token efficiency: 8x more efficient than full-document regeneration [30].

**Explicit Non-Goals:**
*   Real-time multi-player collaboration (v1 is strictly single-player) [31].
*   Document generation as the primary feature (generation is just a convenience; the core product is the review process) [31].
*   Full rich-text editor capabilities (basic formatting only, this is not a Google Docs clone) [31].
