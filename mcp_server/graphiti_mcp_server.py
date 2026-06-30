"""
Graphiti MCP Server for Intent IDE.

CRITICAL: This is the correct entry point for MCP connections.
DO NOT use the standard REST API server in /server — it will return
GET /sse HTTP/1.1" 404 Not Found errors.

Start with:
    cd mcp_server
    python graphiti_mcp_server.py --transport sse

Default endpoint: http://localhost:8000/mcp/
"""

import argparse
import asyncio
import json
import logging
from datetime import datetime, timezone

from config import (
    FALKORDB_HOST,
    FALKORDB_PORT,
    GRAPHITI_LLM_API_KEY,
    GRAPHITI_LLM_MODEL,
    MCP_HOST,
    MCP_PORT,
)

logger = logging.getLogger("graphiti_mcp")

# ---------------------------------------------------------------------------
# Lazy-init Graphiti client (connects on first use)
# ---------------------------------------------------------------------------
_graphiti = None


async def get_graphiti():
    """Return a connected Graphiti instance (singleton)."""
    global _graphiti
    if _graphiti is not None:
        return _graphiti

    from graphiti_core import Graphiti
    from graphiti_core.llm_client import OpenAIClient
    from graphiti_core.llm_client.config import LLMConfig
    from graphiti_core.driver.falkordb_driver import FalkorDriver

    llm_config = LLMConfig(
        api_key=GRAPHITI_LLM_API_KEY,
        model=GRAPHITI_LLM_MODEL,
    )
    llm_client = OpenAIClient(config=llm_config)

    driver = FalkorDriver(
        host=FALKORDB_HOST,
        port=FALKORDB_PORT,
    )

    _graphiti = Graphiti(
        graph_driver=driver,
        llm_client=llm_client,
    )
    await _graphiti.build_indices_and_constraints()
    logger.info("Graphiti connected to FalkorDB at %s:%s", FALKORDB_HOST, FALKORDB_PORT)
    return _graphiti


# ---------------------------------------------------------------------------
# MCP Tool handlers
# ---------------------------------------------------------------------------


async def handle_add_episode(arguments: dict) -> dict:
    """Ingest a document chunk or annotation as a Graphiti Episode."""
    graphiti = await get_graphiti()

    name = arguments.get("name", "untitled")
    episode_body = arguments.get("episode_body", "")
    source_description = arguments.get("source_description", "intent-ide")
    reference_time = arguments.get("reference_time")

    if reference_time:
        ref_time = datetime.fromisoformat(reference_time)
    else:
        ref_time = datetime.now(timezone.utc)

    result = await graphiti.add_episode(
        name=name,
        episode_body=episode_body,
        source_description=source_description,
        reference_time=ref_time,
    )

    return {
        "success": True,
        "episode_count": len(result.edges) if hasattr(result, "edges") and result.edges else 0,
        "name": name,
    }


async def handle_search_nodes(arguments: dict) -> list:
    """Search for entity nodes by semantic query using _search with NodeSearchConfig."""
    graphiti = await get_graphiti()

    from graphiti_core.search.search_config import (
        SearchConfig,
        NodeSearchConfig,
        NodeSearchMethod,
    )

    query = arguments.get("query", "")
    limit = int(arguments.get("limit", 10))

    config = SearchConfig(
        node_config=NodeSearchConfig(
            search_methods=[NodeSearchMethod.cosine_similarity, NodeSearchMethod.bm25],
        ),
        limit=limit,
    )

    results = await graphiti._search(query=query, config=config)

    nodes = []
    for node in results.nodes:
        nodes.append({
            "uuid": node.uuid,
            "name": node.name,
            "summary": node.summary,
            "group_id": node.group_id,
        })

    return nodes


async def handle_search_facts(arguments: dict) -> list:
    """Search for edges/relationships (facts) by semantic query."""
    graphiti = await get_graphiti()

    query = arguments.get("query", "")
    limit = int(arguments.get("limit", 10))

    # search() returns list[EntityEdge] directly
    edges = await graphiti.search(query=query, num_results=limit)

    facts = []
    for edge in edges:
        facts.append({
            "uuid": edge.uuid,
            "name": edge.name,
            "source_node_uuid": edge.source_node_uuid,
            "target_node_uuid": edge.target_node_uuid,
            "fact": edge.fact,
            "valid_at": str(edge.valid_at) if edge.valid_at else None,
            "invalid_at": str(edge.invalid_at) if edge.invalid_at else None,
        })

    return facts


async def handle_get_entity_subgraph(arguments: dict) -> dict:
    """Get the relational neighborhood (blast radius) around an entity."""
    graphiti = await get_graphiti()

    from graphiti_core.search.search_config import (
        SearchConfig,
        EdgeSearchConfig,
        EdgeSearchMethod,
        NodeSearchConfig,
        NodeSearchMethod,
    )

    entity_uuid = arguments.get("entity_uuid", "")
    radius = int(arguments.get("radius", 2))

    # Use _search with BFS centered on the entity
    config = SearchConfig(
        edge_config=EdgeSearchConfig(
            search_methods=[EdgeSearchMethod.bfs],
            bfs_max_depth=radius,
        ),
        node_config=NodeSearchConfig(
            search_methods=[NodeSearchMethod.bfs],
            bfs_max_depth=radius,
        ),
        limit=50,
    )

    results = await graphiti._search(
        query="",
        config=config,
        bfs_origin_node_uuids=[entity_uuid],
    )

    nodes = []
    for node in results.nodes:
        nodes.append({
            "uuid": node.uuid,
            "name": node.name,
            "summary": node.summary,
            "group_id": node.group_id,
        })

    edge_list = []
    for edge in results.edges:
        edge_list.append({
            "source": edge.source_node_uuid,
            "target": edge.target_node_uuid,
            "name": edge.name,
            "fact": edge.fact,
            "valid_at": str(edge.valid_at) if edge.valid_at else None,
            "invalid_at": str(edge.invalid_at) if edge.invalid_at else None,
        })

    return {
        "nodes": nodes,
        "edges": edge_list,
    }


async def handle_invalidate_edge(arguments: dict) -> dict:
    """
    Invalidate an edge by setting its invalid_at timestamp.
    Per EU AI Act compliance: NEVER delete edges, only invalidate.
    Uses direct Cypher query since Graphiti has no built-in invalidate method.
    """
    graphiti = await get_graphiti()

    edge_uuid = arguments.get("edge_uuid", "")
    invalid_at = arguments.get("invalid_at")

    if invalid_at:
        ts = datetime.fromisoformat(invalid_at)
    else:
        ts = datetime.now(timezone.utc)

    # Direct Cypher query to set invalid_at on the edge
    # FalkorDriver.execute_query takes cypher + **kwargs for params
    query = (
        "MATCH ()-[e]->() "
        "WHERE e.uuid = $edge_uuid "
        "SET e.invalid_at = $invalid_at "
        "RETURN e.uuid AS uuid"
    )
    await graphiti.driver.execute_query(
        query, edge_uuid=edge_uuid, invalid_at=ts.isoformat()
    )

    return {"success": True, "edge_uuid": edge_uuid, "invalid_at": str(ts)}


# ---------------------------------------------------------------------------
# MCP Tool registry
# ---------------------------------------------------------------------------

TOOLS = {
    "add_episode": {
        "description": "Ingest a document chunk or user annotation as a Graphiti Episode for knowledge graph construction.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Episode name/label"},
                "episode_body": {"type": "string", "description": "The text content to ingest"},
                "source_description": {"type": "string", "description": "Source identifier (e.g. 'intent-ide-annotation')"},
                "reference_time": {"type": "string", "description": "ISO 8601 timestamp"},
            },
            "required": ["name", "episode_body"],
        },
        "handler": handle_add_episode,
    },
    "search_nodes": {
        "description": "Search for entity nodes in the knowledge graph by semantic query.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Semantic search query"},
                "limit": {"type": "integer", "description": "Max results (default 10)"},
            },
            "required": ["query"],
        },
        "handler": handle_search_nodes,
    },
    "search_facts": {
        "description": "Search for relationships/edges (facts) in the knowledge graph by semantic query.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Semantic search query for facts/relationships"},
                "limit": {"type": "integer", "description": "Max results (default 10)"},
            },
            "required": ["query"],
        },
        "handler": handle_search_facts,
    },
    "get_entity_subgraph": {
        "description": "Get the relational neighborhood (blast radius) around an entity node for cascade checking.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "entity_uuid": {"type": "string", "description": "UUID of the entity node"},
                "radius": {"type": "integer", "description": "Number of hops to traverse (default 2)"},
            },
            "required": ["entity_uuid"],
        },
        "handler": handle_get_entity_subgraph,
    },
    "invalidate_edge": {
        "description": "Invalidate an edge by setting its invalid_at timestamp. Never deletes — preserves audit trail per EU AI Act Article 12.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "edge_uuid": {"type": "string", "description": "UUID of the edge to invalidate"},
                "invalid_at": {"type": "string", "description": "ISO 8601 timestamp (defaults to now)"},
            },
            "required": ["edge_uuid"],
        },
        "handler": handle_invalidate_edge,
    },
}


# ---------------------------------------------------------------------------
# MCP Server (SSE transport)
# ---------------------------------------------------------------------------


def create_mcp_app():
    """Create the MCP server application with SSE transport."""
    from mcp.server import Server
    from mcp.server.sse import SseServerTransport
    from starlette.applications import Starlette
    from starlette.routing import Route, Mount

    server = Server("intent-ide-graphiti")

    @server.list_tools()
    async def list_tools():
        from mcp.types import Tool

        tools = []
        for name, spec in TOOLS.items():
            tools.append(
                Tool(
                    name=name,
                    description=spec["description"],
                    inputSchema=spec["inputSchema"],
                )
            )
        return tools

    @server.call_tool()
    async def call_tool(name: str, arguments: dict):
        from mcp.types import TextContent

        if name not in TOOLS:
            return [TextContent(type="text", text=json.dumps({"error": f"Unknown tool: {name}"}))]

        try:
            result = await TOOLS[name]["handler"](arguments)
            return [TextContent(type="text", text=json.dumps(result))]
        except Exception as e:
            logger.exception("Tool %s failed", name)
            return [TextContent(type="text", text=json.dumps({"error": str(e)}))]

    # SSE transport mounted at /mcp/
    sse = SseServerTransport("/mcp/messages/")

    async def handle_sse(request):
        async with sse.connect_sse(
            request.scope, request.receive, request._send
        ) as streams:
            await server.run(
                streams[0], streams[1], server.create_initialization_options()
            )

    app = Starlette(
        routes=[
            Route("/mcp/sse", endpoint=handle_sse),
            Mount("/mcp/messages/", app=sse.handle_post_message),
        ],
    )

    return app


def create_stdio_server():
    """Create MCP server with stdio transport (for local MCP clients)."""
    from mcp.server import Server
    from mcp.server.stdio import stdio_server

    server = Server("intent-ide-graphiti")

    @server.list_tools()
    async def list_tools():
        from mcp.types import Tool

        tools = []
        for name, spec in TOOLS.items():
            tools.append(
                Tool(
                    name=name,
                    description=spec["description"],
                    inputSchema=spec["inputSchema"],
                )
            )
        return tools

    @server.call_tool()
    async def call_tool(name: str, arguments: dict):
        from mcp.types import TextContent

        if name not in TOOLS:
            return [TextContent(type="text", text=json.dumps({"error": f"Unknown tool: {name}"}))]

        try:
            result = await TOOLS[name]["handler"](arguments)
            return [TextContent(type="text", text=json.dumps(result))]
        except Exception as e:
            logger.exception("Tool %s failed", name)
            return [TextContent(type="text", text=json.dumps({"error": str(e)}))]

    return server, stdio_server


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description="Graphiti MCP Server for Intent IDE")
    parser.add_argument(
        "--transport",
        choices=["sse", "stdio"],
        default="sse",
        help="MCP transport type (default: sse)",
    )
    parser.add_argument("--host", default=MCP_HOST, help=f"Host (default: {MCP_HOST})")
    parser.add_argument("--port", type=int, default=MCP_PORT, help=f"Port (default: {MCP_PORT})")
    parser.add_argument("--debug", action="store_true", help="Enable debug logging")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.debug else logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    if args.transport == "sse":
        import uvicorn

        logger.info(
            "Starting Graphiti MCP server (SSE) at http://%s:%s/mcp/",
            args.host,
            args.port,
        )
        app = create_mcp_app()
        uvicorn.run(app, host=args.host, port=args.port)
    else:
        logger.info("Starting Graphiti MCP server (stdio)")
        server, stdio_fn = create_stdio_server()

        async def run_stdio():
            async with stdio_fn() as streams:
                await server.run(
                    streams[0], streams[1], server.create_initialization_options()
                )

        asyncio.run(run_stdio())


if __name__ == "__main__":
    main()
