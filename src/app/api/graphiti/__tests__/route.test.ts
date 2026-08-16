import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Route-level tests for the same-origin Graphiti MCP proxy:
//   POST {toolName, args} → forwards the MCP tools/call envelope to
//   GRAPHITI_MCP_URL (default http://localhost:8000/mcp/) with a 1.5s budget.
//   Production without GRAPHITI_MCP_URL → 501 {reason:'disabled'}.

/** Fresh module instance per test so env stubs apply cleanly. */
async function loadRoute() {
  vi.resetModules()
  return import('@/app/api/graphiti/route')
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/graphiti', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('POST /api/graphiti — production gate', () => {
  it('returns 501 {reason: "disabled"} in production when GRAPHITI_MCP_URL is unset', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('GRAPHITI_MCP_URL', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute()
    const res = await POST(postRequest({ toolName: 'search_nodes', args: {} }))
    expect(res.status).toBe(501)
    expect(await res.json()).toEqual({ reason: 'disabled' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards in production when GRAPHITI_MCP_URL is configured', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('GRAPHITI_MCP_URL', 'https://graph.internal.example/mcp/')
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ result: { ok: true } }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute()
    const res = await POST(postRequest({ toolName: 'search_nodes', args: { query: 'q' } }))
    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://graph.internal.example/mcp/')
  })
})

describe('POST /api/graphiti — envelope forwarding', () => {
  it('forwards the MCP tools/call envelope to the default URL and returns {result}', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ result: { nodes: [{ uuid: 'u1' }] } }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute()
    const res = await POST(
      postRequest({ toolName: 'search_nodes', args: { query: 'budget', limit: 5 } }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ result: { nodes: [{ uuid: 'u1' }] } })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://localhost:8000/mcp/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      method: 'tools/call',
      params: { name: 'search_nodes', arguments: { query: 'budget', limit: 5 } },
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('defaults missing args to {}', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ result: null }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute()
    await POST(postRequest({ toolName: 'get_status' }))
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(JSON.parse(init.body as string).params.arguments).toEqual({})
  })

  it('rejects a missing/non-string toolName with 400 before any upstream call', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute()
    for (const body of [{}, { toolName: 42 }, { toolName: '' }]) {
      const res = await POST(postRequest(body))
      expect(res.status).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/graphiti — upstream failures', () => {
  it('passes an upstream error status through', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('graph exploded', { status: 500 })),
    )

    const { POST } = await loadRoute()
    const res = await POST(postRequest({ toolName: 'search_nodes', args: {} }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'graph exploded' })
  })

  it('maps a timeout (TimeoutError) to 504', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const err = new Error('The operation was aborted due to timeout')
        err.name = 'TimeoutError'
        throw err
      }),
    )

    const { POST } = await loadRoute()
    const res = await POST(postRequest({ toolName: 'search_nodes', args: {} }))
    expect(res.status).toBe(504)
  })

  it('maps a network failure to 502', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    )

    const { POST } = await loadRoute()
    const res = await POST(postRequest({ toolName: 'search_nodes', args: {} }))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'ECONNREFUSED' })
  })
})
