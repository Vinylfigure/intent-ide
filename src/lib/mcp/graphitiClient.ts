/**
 * Graphiti MCP Client — HTTP transport to local knowledge graph.
 *
 * IMPORTANT: The MCP server must be started via `graphiti_mcp_server.py`
 * in the /mcp_server directory, NOT the standard REST API server in /server.
 * The REST server exposes different endpoints and will return SSE 404 errors.
 *
 * Start with: python graphiti_mcp_server.py --transport sse
 * Default endpoint: http://localhost:8000/mcp/
 */

const GRAPHITI_MCP_URL =
  process.env.GRAPHITI_MCP_URL ?? "http://localhost:8000/mcp/"

export interface Episode {
  name: string
  content: string
  sourceDescription?: string
  referenceTime?: string
}

export interface GraphNode {
  uuid: string
  name: string
  summary: string
  groupId?: string
}

export interface GraphEdge {
  uuid: string
  name: string
  source: string
  target: string
  sourceNodeUuid: string
  targetNodeUuid: string
  fact: string
  validAt: string | null
  invalidAt: string | null
}

export interface SubgraphResult {
  nodes: GraphNode[]
  edges: Array<{ source: string; target: string; name?: string; fact: string; validAt?: string | null; invalidAt?: string | null }>
}

async function mcpCall<T>(toolName: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(GRAPHITI_MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  })
  if (!response.ok) {
    throw new Error(`Graphiti ${toolName} failed: ${response.status}`)
  }
  const data = await response.json()
  return data.result as T
}

export async function addEpisode(episode: Episode): Promise<{ success: boolean }> {
  await mcpCall("add_episode", {
    name: episode.name,
    episode_body: episode.content,
    source_description: episode.sourceDescription ?? "intent-ide-annotation",
    reference_time: episode.referenceTime ?? new Date().toISOString(),
  })
  return { success: true }
}

export async function searchNodes(query: string, limit = 10): Promise<GraphNode[]> {
  return mcpCall<GraphNode[]>("search_nodes", { query, limit })
}

export async function getSubgraph(nodeId: string, radius = 2): Promise<SubgraphResult> {
  return mcpCall<SubgraphResult>("get_entity_subgraph", {
    entity_uuid: nodeId,
    radius,
  })
}

export async function searchFacts(query: string, limit = 10): Promise<GraphEdge[]> {
  return mcpCall<GraphEdge[]>("search_facts", { query, limit })
}

export async function invalidateEdge(
  edgeUuid: string,
  invalidAt?: string,
): Promise<{ success: boolean }> {
  return mcpCall<{ success: boolean }>("invalidate_edge", {
    edge_uuid: edgeUuid,
    ...(invalidAt ? { invalid_at: invalidAt } : {}),
  })
}
