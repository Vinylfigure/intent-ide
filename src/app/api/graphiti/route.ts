import { NextRequest, NextResponse } from 'next/server'

/**
 * Same-origin proxy for the local Graphiti MCP server, so the browser never
 * talks to http://localhost:8000 directly.
 *
 * IMPORTANT: The MCP server must be started via `graphiti_mcp_server.py`
 * in the /mcp_server directory, NOT the standard REST API server in /server.
 * The REST server exposes different endpoints and will return SSE 404 errors.
 *
 * Request:  POST { toolName: string, args: Record<string, unknown> }
 * Response: { result } on success, or an error status:
 *   501 { reason: 'disabled' } — production deploy without GRAPHITI_MCP_URL
 *                                (there is no local graph stack to reach).
 *   upstream status            — the MCP server answered non-2xx.
 *   504 / 502                  — timeout (1.5s budget) / network failure.
 *
 * All graph traffic is best-effort in the client (cascade checks, episode
 * ingestion), so failures here degrade to "fewer edges", never a broken UI.
 */

export async function POST(request: NextRequest) {
  const configuredUrl = process.env.GRAPHITI_MCP_URL
  if (process.env.NODE_ENV === 'production' && !configuredUrl) {
    return NextResponse.json({ reason: 'disabled' }, { status: 501 })
  }

  let toolName: unknown
  let args: unknown
  try {
    ;({ toolName, args } = await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof toolName !== 'string' || !toolName) {
    return NextResponse.json({ error: 'toolName is required' }, { status: 400 })
  }

  try {
    const upstream = await fetch(configuredUrl ?? 'http://localhost:8000/mcp/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'tools/call',
        params: { name: toolName, arguments: args ?? {} },
      }),
      // The graph is a best-effort enrichment — fail fast rather than holding
      // the caller's request open against a stack that may not be running.
      signal: AbortSignal.timeout(1500),
    })

    if (!upstream.ok) {
      const text = await upstream.text()
      return NextResponse.json(
        { error: text || `Graphiti upstream error ${upstream.status}` },
        { status: upstream.status }
      )
    }

    const data = await upstream.json()
    return NextResponse.json({ result: data.result })
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError'
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Graphiti call failed' },
      { status: isTimeout ? 504 : 502 }
    )
  }
}
