# Feature Spec: Compliance & Audit Infrastructure

> Bracketed citation markers (e.g. [1], [4, 5]) reference sections of the internal Intent IDE PRD from which this spec was distilled.

## 1. Regulatory Context & ALCOA+ Principles
This application operates in a high-risk environment governed by the EU AI Act and global data integrity standards. To comply, the system architecture must natively enforce the **ALCOA+ principles**: data must be Attributable, Legible, Contemporaneous, Original, Accurate, Complete, Consistent, Enduring, Available, and Traceable [4, 5]. 

*   **Article 12 (Record-Keeping):** Requires infrastructure that *automatically* captures every prediction, input, decision, and outcome [3, 6]. Manual reporting is insufficient [3].
*   **Article 14 (Human Oversight):** Demands a Human-in-the-Loop (HITL) model where the user can understand the output, disregard/correct decisions, and stop the system [7, 8].
*   **Article 72 (Monitoring):** Requires continuous post-market monitoring and anomaly detection to flag unusual system behavior [9].

## 2. Minimum Viable Audit Schema (Database Design)
To satisfy the superset of regulatory frameworks (EU AI Act, NIST AI RMF, ISO 42001), the relational database MUST implement a 14-field "Minimum Viable Audit Schema" for every AI transaction [2, 10]. 

The agent must build the `AuditLog` table to include:
*   `Timestamp_UTC`: ISO 8601 exact time of the event (Contemporaneous) [2].
*   `Audit_ID`: Unique, immutable identifier linking back to the source [2].
*   `User_ID`: Anonymized identifier with role classification (Attributable) [2].
*   `Model_Name` & `Model_Version`: Exact specification of the LLM deployed [2].
*   `Prompt_Version`: The specific prompt template used, which acts as a version-controlled business constraint [2, 11].
*   `Query_Classification`: Business context mapping (e.g., FIX, RESTRUCTURE) [2].
*   `Source_Documents`: Complete document provenance (e.g., specific GraphRAG node IDs retrieved) [2, 10].
*   `Confidence_Score`: Model-generated token-level uncertainty metrics [2].
*   `Response_ID`: Unique identifier linking input to output [2].
*   `Output_Type`: Format of the AI output (e.g., SEMANTIC_COMMIT) [2].
*   `Regulatory_Context`: Applicable regulation framework [2].
*   `Approval_Status`: Workflow state ensuring HITL (e.g., PENDING_REVIEW, APPROVED_HUMAN, APPROVED_AUTO) [2].
*   `Data_Retention_Days`: System-enforced data lifespan [2].

## 3. Infrastructure & Immutability Rules
The audit trail is only legally defensible if it cannot be altered after the fact.
*   **Append-Only Storage:** Audit logs must be written to immutable, tamper-evident storage [12, 13].
*   **No Operator Overwrites:** The application UI must NEVER allow a user to edit or deactivate the audit logs [4, 14]. Any change to data must log the `Old Value` and `New Value` without obscuring the original record [15].
*   **Real-Time Logging:** Logging must happen at inference time, capturing both the inputs (including reference databases) and outputs simultaneously [16, 17]. 

## 4. Source Attribution & Context Lineage
Regulators will reject outputs lacking documentary support [18].
*   **Traceability:** The AI must explicitly cite the `Source_Documents` it used to generate a semantic commit [2, 18]. 
*   **Missing Sources:** If the GraphRAG backend cannot find a supporting fact, the UI must explicitly handle the missing source rather than allowing the LLM to hallucinate a bridge [19]. 

## 5. Human Oversight Controls (Article 14)
*   **The Approval Gate:** The system must never auto-apply global document changes. Every AI-generated output must default to `PENDING_REVIEW` and require explicit human sign-off [2].
*   **Override Documentation:** If a user rejects or tweaks an AI-proposed Semantic Commit, the system must log the human intervention and, optionally, prompt the user for a reason [20, 21].
