"""
Graphiti MCP Server Configuration.

Reads from environment variables (with .env support via python-dotenv).
"""

import os
from dotenv import load_dotenv

# Load .env from project root (one level up)
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

# --- FalkorDB ---
FALKORDB_HOST = os.getenv("FALKORDB_HOST", "localhost")
FALKORDB_PORT = int(os.getenv("FALKORDB_PORT", "6379"))

# --- Graphiti LLM (used for entity extraction during episode ingestion) ---
GRAPHITI_LLM_PROVIDER = os.getenv("GRAPHITI_LLM_PROVIDER", "openai")  # openai | anthropic
GRAPHITI_LLM_API_KEY = os.getenv("GRAPHITI_LLM_API_KEY", "")
GRAPHITI_LLM_MODEL = os.getenv("GRAPHITI_LLM_MODEL", "gpt-4o-mini")

# --- MCP Server ---
MCP_HOST = os.getenv("MCP_HOST", "0.0.0.0")
MCP_PORT = int(os.getenv("MCP_PORT", "8000"))

# --- Graphiti Schema Constants ---
# Node types (maps to techContext.md Section 2.2)
ENTITY_NODE_TYPE = "Entity"
EPISODE_NODE_TYPE = "Episode"

# Edge types
EDGE_RELATES_TO = "RELATES_TO"
EDGE_MENTIONED_IN = "MENTIONED_IN"
EDGE_OCCURRED_AFTER = "OCCURRED_AFTER"

# Entity types extracted from documents
ENTITY_TYPES = [
    "concept",
    "person",
    "organization",
    "rule",
    "component",
    "requirement",
    "section",
    "term",
]
