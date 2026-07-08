# Feature Spec: Semantic Commits & UI/UX

> Bracketed citation markers (e.g. [1], [4, 5]) reference sections of the internal Intent IDE PRD from which this spec was distilled.

## 1. Core Philosophy: Impact Analysis First
When updating an intent specification (e.g., project rules, memory, or document context), the UI must support "semantic conflict resolution" [1]. Research shows that users strongly prefer an "Impact Analysis" workflow—they want the AI to flag potential conflicts across the document *before* the AI generates any automated rewrites [2]. 

**Strict UI Rule:** The interface MUST separate conflict *detection* from conflict *resolution*. Do not force users into a workflow where global changes are applied automatically without review [4, 5].

## 2. Global vs. Local Resolution Controls
The UI must provide a spectrum of control, allowing the user to seamlessly switch between high-level overviews and granular line edits [5].

### A. Global Actions (The Command Bar)
Implement the following global actions for the document [6]:
*   **"Check for Conflicts" (Impact Analysis):** Highlights potential semantic conflicts without suggesting immediate textual changes [6]. This allows the user to gauge the "blast radius" of their intent [7].
*   **"Make Change" (Global Rewrite):** Performs conflict detection and simultaneously lets the AI propose rewrites for the highly conflicting items [6].
*   **"Clear All Conflicts" / "Revert All":** Global escape hatches to return to the base state [8].

### B. Local Actions (Granular Review)
For every flagged conflict in the document, provide a localized interaction component [8, 9]:
*   **Hover for Reasoning:** When a user hovers over a highlighted conflict, the UI MUST display the AI's internal reasoning for *why* it flagged the item [8, 10].
*   **Resolution Strategies:** Provide inline buttons to "Revise", "Delete", or "Add" specific to that chunk [11].
*   **Ease of Reversibility:** Users must be able to accept or reject a specific AI-proposed line change instantly without relying on a global "undo" button [12].

## 3. Visualizing Conflict and Uncertainty
The UI must use visual indicators to represent the AI's confidence and the severity of conflicts [13, 14].

### A. Conflict Severity Highlighting
*   **Direct Conflicts (Red):** Use a red highlight (e.g., `$status-red`) for items that directly contradict the user's new intent [13, 14].
*   **Ambiguities (Orange/Pink):** Use a softer color (e.g., orange or pink) for items where the impact is uncertain or requires clarification [13, 15].

### B. Token-Level Uncertainty (The Edit Model)
Standard LLM generation probabilities (entropy) are not enough, as models often assign high uncertainty to trivial formatting choices [16]. 
*   **Implementation:** Highlight generated tokens based on an "edit model"—the likelihood that a human will need to modify or delete that specific word [3, 17]. 
*   **UI Representation:** Apply a subtle background gradient to uncertain tokens to draw the reviewer's eye exactly where their expertise is needed, significantly speeding up task completion [18, 19]. Do NOT use raw numerical probability scores in the UI, as users find them distracting [20].

## 4. The "Plan/Act" Gatekeeper
When applying a semantic commit that alters global project memory, the UI must act as a gatekeeper [21]. 
*   Always display a Diff Viewer or Smart Diff before finalizing the commit [22, 23]. 
*   Wrap destructive actions in a `<Confirmation>` human-in-the-loop (HITL) component to ensure the user actively verifies the semantic alignment [22, 24].
