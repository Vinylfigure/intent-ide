# Product Context: Intent IDE (v7.0)

## 1. The Problem Space
Intent IDE exists to solve critical failures in current AI-assisted document workflows. While AI can often generate text that is "90% right," the process of reviewing and fixing the remaining 10% introduces severe cognitive and psychological risks:
*   **Interruption Fatigue & Flow Loss:** Context switching is devastating to knowledge work. Traditional AI chat interfaces force users to abandon their reading flow to write complex prompts [5]. Furthermore, interrupting a user mid-thought (a "fine breakpoint") drastically increases cognitive load and error rates [4, 6].
*   **Automation Bias & Sycophancy:** Frictionless "auto-apply" AI features cause humans to become passive readers, blindly accepting flawed AI suggestions [2]. Under the hood, LLMs naturally exhibit "sycophancy," meaning they will confidently agree with a user's incorrect assumption just to be polite [7, 8].
*   **The "Blast Radius" Problem:** Changing a rule in paragraph 2 often breaks a clause in paragraph 10. Standard AI editors fail to detect these multi-hop semantic conflicts, leading to corrupted documents [3, 9].

## 2. User Experience Goals
*   **Protect the Flow State:** The UI must anchor all AI interactions to the user's current reading position.
*   **Enforce Professional Skepticism:** The interface must intentionally introduce "positive friction" to compel human critical thinking before applying global changes [10].
*   **Provide Defensible Transparency:** Every AI action must be easily understandable, reversible, and auditable to satisfy enterprise compliance (e.g., EU AI Act Article 14) [9, 11].

---

## 3. Core UI/UX Mechanics (Strict Implementation Rules)

The frontend components (built using `shadcn/ui` and `assistant-ui`) MUST strictly implement the following cognitive frameworks:

### A. The Read-Line (Event Segmentation)
Human cognition processes tasks in chunks separated by breakpoints [6]. 
*   **Mechanism:** The UI tracks the user's scroll position and dwell time (e.g., 2 seconds minimum for a heading, ~24 seconds for a paragraph) to establish a "Read-Line" [12, 13].
*   **Rule for Notifications:** The IDE MUST NEVER display a popup or downstream AI alert mid-sentence (a "fine breakpoint"). All background AI findings (Cascade Flags) must be buffered and delivered ONLY when the user reaches a "coarse breakpoint" (e.g., scrolling to a new section or the end of a paragraph) [4, 6].

### B. Semantic Commits (Plan/Act Mode)
Users do not edit text; they commit intent [3]. Before any global change is applied, the UI must separate *impact analysis* from *generation* [14].
*   **Mechanism:** When a user requests a change (e.g., "Restructure this"), the AI first presents a "Semantic Commit" preview [15].
*   **UI Pattern:** Use a split-canvas or diff-viewer. The interface must visualize the "blast radius" (how the local change impacts downstream rules) BEFORE the user clicks 'Apply' [3, 16]. 

### C. Cognitive Forcing Functions (Positive Friction)
To combat automation bias, the UI must not make accepting AI changes completely frictionless [2].
*   **Provocations:** The AI will occasionally generate "Provocations" (rendered in distinct `<Callout>` or `<Alert>` blocks) [2, 10]. These are brief, devil's-advocate critiques that challenge the user's intent or highlight edge cases [17].
*   **Token-Level Uncertainty Highlighting:** Instead of a generic document-level confidence score, the UI MUST use color-coding to highlight the specific tokens (words) the AI is least confident about [18-20]. This directs the human reviewer's critical eye exactly where their expertise is required, significantly improving review speed and accuracy [21].

### D. Interactive Reasoning & Chain of Thought
Because every annotation routes through a Multi-Agent Debating System (MADS), the user needs to see the AI's logic [8, 22].
*   **Mechanism:** Utilize the `assistant-ui` or `ai-sdk-elements` `<Reasoning>` and `<ChainOfThought>` components [23-25]. 
*   **UI Pattern:** The debate between the "Troublemaker" agent and "Peacemaker" agent should be summarized in a collapsible reasoning block [26]. This provides transparency into *why* the AI arrived at its suggested Semantic Commit.

---

## 4. The Agentic User Flow
1.  **Capture:** User highlights text and speaks/types a note. (Highlight to voice capture must take < 1 second) [27].
2.  **Classification:** The system classifies the intent (e.g., *Question*, *Correction*, *Restructure*) [13].
3.  **Debate (Background):** The Multi-Agent system retrieves the GraphRAG context and debates the resolution [8].
4.  **Breakpoint Delivery:** The user continues reading. Once they reach a coarse breakpoint, the UI reveals the agent's proposed Semantic Commit, complete with Uncertainty Highlighting and a potential Provocation [6, 10, 18].
5.  **Resolution:** The user evaluates the blast radius, adjusts if necessary, and accepts the change. The session context updates automatically [15, 28].
