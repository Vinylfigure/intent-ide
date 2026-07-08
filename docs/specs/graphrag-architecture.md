# Feature Spec: GraphRAG & Semantic Memory Architecture

> Bracketed citation markers (e.g. [1], [4, 5]) reference sections of the internal Intent IDE PRD from which this spec was distilled.

## 1. Architectural Philosophy
Traditional Retrieval-Augmented Generation (RAG) relies on semantic similarity (vector databases) to retrieve isolated text chunks, which severely limits "multi-hop" reasoning [1, 2]. To determine the "blast radius" of a document edit, the system must traverse explicit, multi-step dependencies [1]. 

Intent IDE achieves this using **GraphRAG** powered by **Graphiti**, a temporally aware knowledge graph engine [3]. It translates unstructured text into a structured network of entities and explicit relationships (edges) [1, 4].

## 2. The Three-Tier Subgraph Structure
The Graphiti backend organizes memory into a strict hierarchical structure to balance raw data preservation with semantic reasoning [5, 6]:

1.  **Episode Subgraph (Provenance):** The foundational layer that stores raw, auditable units of data (e.g., individual document chunks or user annotations) with precise timestamps [5, 6]. This ensures every AI claim can be traced back to its original source [7].
2.  **Semantic Entity Subgraph (The Logic Layer):** This layer extracts the structured knowledge from episodes into Nodes (Entities) and Edges (Relationships) [5, 6]. 
3.  **Community Subgraph (Global Themes):** Groups related entities into thematic clusters, enabling the LLM to answer broad, high-level questions without traversing millions of individual edges [5, 6].

## 3. Temporal Tracking & Conflict Management
User requirements and document rules change over time. Graphiti handles these changes using a **bi-temporal model** [8, 9].
*   Every fact (edge) in the graph has a validity window defined by `t_valid` and `t_invalid` timestamps [8, 10].
*   When a user overrides an existing rule, the system **must not delete** the old relationship. Instead, it invalidates the previous fact by setting its `invalid_at` timestamp, and creates a new valid relationship [8-10]. This preserves an immutable audit trail for compliance [10].

## 4. The "Cascade Check" (Blast Radius Analysis)
To execute the "Plan/Act" Semantic Commit UI, the backend must calculate the downstream impact of a user's local edit [11, 12].
1.  **Node Identification:** Locate the graph node(s) corresponding to the highlighted text chunk [12].
2.  **Multi-Hop Traversal:** Traverse explicit dependency edges (e.g., `CONSTRAINS`, `DEPENDS_ON`, `RELATES_TO`) extending outward from the target node [1, 13].
3.  **Sub-graph Extraction:** Return this specific relational neighborhood (the blast radius) to the LLM's context window, forcing the Multi-Agent Debating System to analyze these exact conflicts before proposing a change [12, 14].

## 5. Denoising & Entity Resolution
LLMs naturally hallucinate or create redundant nodes during graph construction (e.g., creating separate nodes for "LLMs", "Large Language Models", and "llms") [15, 16].
*   **Implementation Rule:** The system must implement an **Entity Resolution** step that merges duplicates into a single canonical entity [16, 17].
*   **Triple Reflection:** The system must use an LLM-as-a-judge to score the reliability of extracted relations, filtering out low-confidence or erroneous edges to keep the graph compact and fast [15, 18].

## 6. MCP Server Integration
The IDE frontend communicates with the graph database (FalkorDB/Neo4j) exclusively via the Model Context Protocol (MCP) [19]. The LangGraph orchestrator will utilize tools like `add_episode` (to ingest new data) and `search_facts` (to retrieve edges for the Cascade Check) [20].
