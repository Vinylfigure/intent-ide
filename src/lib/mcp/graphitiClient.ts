/**
 * Graphiti MCP Client — talks to the local knowledge graph through the
 * same-origin /api/graphiti proxy (which forwards the MCP `tools/call`
 * envelope to GRAPHITI_MCP_URL, default http://localhost:8000/mcp/).
 *
 * IMPORTANT: The MCP server must be started via `graphiti_mcp_server.py`
 * in the /mcp_server directory, NOT the standard REST API server in /server.
 * The REST server exposes different endpoints and will return SSE 404 errors.
 *
 * Start with: python graphiti_mcp_server.py --transport sse
 */

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

async function mcpCall<T>(
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/api/graphiti", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toolName, args }),
    ...(signal ? { signal } : {}),
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

export async function searchNodes(
  query: string,
  limit = 10,
  signal?: AbortSignal,
): Promise<GraphNode[]> {
  return mcpCall<GraphNode[]>("search_nodes", { query, limit }, signal)
}

export async function getSubgraph(
  nodeId: string,
  radius = 2,
  signal?: AbortSignal,
): Promise<SubgraphResult> {
  return mcpCall<SubgraphResult>(
    "get_entity_subgraph",
    { entity_uuid: nodeId, radius },
    signal,
  )
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
