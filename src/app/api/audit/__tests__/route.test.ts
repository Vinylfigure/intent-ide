import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Route-level tests for the hardened /api/audit endpoint:
//   POST — 16KB content-length cap (413), per-IP soft rate limit 30/min (429),
//          per-field string caps, numeric coercion.
//   GET  — per-visitor scoping via ?userId=, unscoped reads gated behind
//          Bearer AUDIT_ADMIN_TOKEN when the env var is set, limit clamping.
//
// Prisma is mocked; vi.hoisted keeps the same fn refs across vi.resetModules
// (needed because the rate-limit Map is module-level state).

const { createMock, findManyMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  findManyMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    auditLog: {
      create: createMock,
      findMany: findManyMock,
    },
  },
}))

/** Fresh module instance per test so the per-IP rate-limit Map starts empty. */
async function loadRoute() {
  vi.resetModules()
  return import('@/app/api/audit/route')
}

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/audit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function getRequest(query = '', headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/audit${query}`, { headers })
}

beforeEach(() => {
  createMock.mockReset().mockResolvedValue({ id: 'rec-1' })
  findManyMock.mockReset().mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ── POST: body size cap ───────────────────────────────────────────────────────

describe('POST /api/audit — content-length cap', () => {
  it('rejects a body over 16KB with 413 before touching the database', async () => {
    const { POST } = await loadRoute()
    const res = await POST(
      postRequest({ action: 'log' }, { 'content-length': String(16 * 1024 + 1) }),
    )
    expect(res.status).toBe(413)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('accepts a body exactly at the 16KB boundary', async () => {
    const { POST } = await loadRoute()
    const res = await POST(
      postRequest({ action: 'log' }, { 'content-length': String(16 * 1024) }),
    )
    expect(res.status).toBe(200)
    expect(createMock).toHaveBeenCalledTimes(1)
  })
})

// ── POST: rate limiting ───────────────────────────────────────────────────────

describe('POST /api/audit — per-IP rate limit', () => {
  it('allows 30 writes per window, rejects the 31st with 429', async () => {
    const { POST } = await loadRoute()
    const headers = { 'x-forwarded-for': '203.0.113.5' }

    for (let i = 0; i < 30; i++) {
      const res = await POST(postRequest({ action: 'log' }, headers))
      expect(res.status).toBe(200)
    }
    const blocked = await POST(postRequest({ action: 'log' }, headers))
    expect(blocked.status).toBe(429)
    expect(createMock).toHaveBeenCalledTimes(30)
  })

  it('rate limits per IP — a different IP is unaffected', async () => {
    const { POST } = await loadRoute()
    for (let i = 0; i < 31; i++) {
      await POST(postRequest({ action: 'log' }, { 'x-forwarded-for': '203.0.113.5' }))
    }
    const other = await POST(postRequest({ action: 'log' }, { 'x-forwarded-for': '198.51.100.7' }))
    expect(other.status).toBe(200)
  })

  it('prefers x-real-ip (edge-set) over the spoofable x-forwarded-for', async () => {
    const { POST } = await loadRoute()
    // Same real IP rotating fake XFF values must still hit the limit.
    for (let i = 0; i < 30; i++) {
      await POST(
        postRequest(
          { action: 'log' },
          { 'x-real-ip': '203.0.113.5', 'x-forwarded-for': `198.51.100.${i}` },
        ),
      )
    }
    const blocked = await POST(
      postRequest(
        { action: 'log' },
        { 'x-real-ip': '203.0.113.5', 'x-forwarded-for': '198.51.100.99' },
      ),
    )
    expect(blocked.status).toBe(429)
  })

  it('uses the FIRST hop of a multi-hop x-forwarded-for chain', async () => {
    const { POST } = await loadRoute()
    // 30 writes as client 203.0.113.5 behind different proxies
    for (let i = 0; i < 30; i++) {
      await POST(
        postRequest({ action: 'log' }, { 'x-forwarded-for': `203.0.113.5, 10.0.0.${i}` }),
      )
    }
    const blocked = await POST(
      postRequest({ action: 'log' }, { 'x-forwarded-for': '203.0.113.5, 10.0.0.99' }),
    )
    expect(blocked.status).toBe(429)
  })

  it('resets the window after 60 seconds', async () => {
    vi.useFakeTimers()
    try {
      const { POST } = await loadRoute()
      const headers = { 'x-forwarded-for': '203.0.113.5' }
      for (let i = 0; i < 31; i++) {
        await POST(postRequest({ action: 'log' }, headers))
      }
      expect((await POST(postRequest({ action: 'log' }, headers))).status).toBe(429)

      vi.advanceTimersByTime(60_001)
      expect((await POST(postRequest({ action: 'log' }, headers))).status).toBe(200)
    } finally {
      vi.useRealTimers()
    }
  })
})

// ── POST: field capping and coercion (capString behavior) ────────────────────

describe('POST /api/audit — field caps and numeric validation', () => {
  // Oversize fields REJECT rather than truncate: sourceDocuments/graphNodesUsed
  // hold JSON arrays, and a mid-string cut would store corrupt provenance.
  it('rejects oversize fields with 400 instead of silently truncating', async () => {
    const { POST } = await loadRoute()

    for (const params of [
      { modelName: 'm'.repeat(513) },
      { sourceDocuments: 's'.repeat(4097) },
      { graphNodesUsed: 'g'.repeat(4097) },
      { overrideReason: 'r'.repeat(1025) },
    ]) {
      const res = await POST(postRequest({ action: 'log', ...params }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/Field too long/)
    }
    expect(createMock).not.toHaveBeenCalled()
  })

  it('accepts fields exactly at their limits', async () => {
    const { POST } = await loadRoute()
    const res = await POST(
      postRequest({
        action: 'log',
        modelName: 'm'.repeat(512),
        sourceDocuments: 's'.repeat(4096),
        overrideReason: 'r'.repeat(1024),
      }),
    )
    expect(res.status).toBe(200)
    const data = createMock.mock.calls[0][0].data
    expect(data.modelName).toHaveLength(512)
    expect(data.sourceDocuments).toHaveLength(4096)
    expect(data.overrideReason).toHaveLength(1024)
  })

  it('leaves strings at or under the limit untouched', async () => {
    const { POST } = await loadRoute()
    await POST(postRequest({ action: 'log', modelName: 'claude-sonnet-4-6' }))
    expect(createMock.mock.calls[0][0].data.modelName).toBe('claude-sonnet-4-6')
  })

  it('replaces non-string fields with their fallbacks (type confusion guard)', async () => {
    const { POST } = await loadRoute()
    await POST(
      postRequest({
        action: 'log',
        userId: 12345, // number, not string
        modelName: { evil: true }, // object
        sourceDocuments: ['a', 'b'], // array
        outputType: null,
        resolutionId: 42, // non-string -> undefined
        overrideOf: false, // non-string -> undefined
      }),
    )

    const data = createMock.mock.calls[0][0].data
    expect(data.userId).toBe('local')
    expect(data.modelName).toBe('')
    expect(data.sourceDocuments).toBe('[]')
    expect(data.outputType).toBe('RESOLUTION')
    expect(data.resolutionId).toBeUndefined()
    expect(data.overrideOf).toBeUndefined()
  })

  it('nulls non-finite confidenceScore and keeps valid numbers', async () => {
    const { POST } = await loadRoute()
    await POST(postRequest({ action: 'log', confidenceScore: 'high' }))
    await POST(postRequest({ action: 'log', confidenceScore: Number.NaN }))
    await POST(postRequest({ action: 'log', confidenceScore: 0.87 }))

    expect(createMock.mock.calls[0][0].data.confidenceScore).toBeNull()
    expect(createMock.mock.calls[1][0].data.confidenceScore).toBeNull()
    expect(createMock.mock.calls[2][0].data.confidenceScore).toBe(0.87)
  })

  it('truncates fractional dataRetentionDays and falls back on junk', async () => {
    const { POST } = await loadRoute()
    await POST(postRequest({ action: 'log', dataRetentionDays: 30.9 }))
    await POST(postRequest({ action: 'log', dataRetentionDays: 'forever' }))
    await POST(postRequest({ action: 'log', dataRetentionDays: Infinity }))

    expect(createMock.mock.calls[0][0].data.dataRetentionDays).toBe(30)
    expect(createMock.mock.calls[1][0].data.dataRetentionDays).toBe(2555)
    expect(createMock.mock.calls[2][0].data.dataRetentionDays).toBe(2555)
  })

  it('returns 400 for an unknown action', async () => {
    const { POST } = await loadRoute()
    const res = await POST(postRequest({ action: 'drop-tables' }))
    expect(res.status).toBe(400)
    expect(createMock).not.toHaveBeenCalled()
  })
})

// ── GET: visitor scoping and admin gate ──────────────────────────────────────

describe('GET /api/audit — scoping and admin token', () => {
  it('scopes to the requested userId', async () => {
    const { GET } = await loadRoute()
    const res = await GET(getRequest('?userId=visitor-abc'))
    expect(res.status).toBe(200)
    expect(findManyMock.mock.calls[0][0].where).toEqual({ userId: 'visitor-abc' })
  })

  it('combines userId scoping with a status filter', async () => {
    const { GET } = await loadRoute()
    await GET(getRequest('?userId=visitor-abc&status=PENDING_REVIEW'))
    expect(findManyMock.mock.calls[0][0].where).toEqual({
      userId: 'visitor-abc',
      approvalStatus: 'PENDING_REVIEW',
    })
  })

  it('allows unscoped reads when AUDIT_ADMIN_TOKEN is unset (local dev)', async () => {
    const { GET } = await loadRoute()
    const res = await GET(getRequest())
    expect(res.status).toBe(200)
    expect(findManyMock).toHaveBeenCalledTimes(1)
  })

  it('fails CLOSED in production: unscoped reads are denied when no token is configured', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { GET } = await loadRoute()
    const res = await GET(getRequest())
    expect(res.status).toBe(401)
    expect(findManyMock).not.toHaveBeenCalled()
  })

  it('rejects unscoped reads with 401 when the admin token is set and absent/wrong', async () => {
    vi.stubEnv('AUDIT_ADMIN_TOKEN', 'secret-token')
    const { GET } = await loadRoute()

    const noAuth = await GET(getRequest())
    expect(noAuth.status).toBe(401)

    const wrongAuth = await GET(getRequest('', { authorization: 'Bearer wrong-token' }))
    expect(wrongAuth.status).toBe(401)

    expect(findManyMock).not.toHaveBeenCalled()
  })

  it('allows unscoped reads with the correct bearer token', async () => {
    vi.stubEnv('AUDIT_ADMIN_TOKEN', 'secret-token')
    const { GET } = await loadRoute()
    const res = await GET(getRequest('', { authorization: 'Bearer secret-token' }))
    expect(res.status).toBe(200)
    expect(findManyMock).toHaveBeenCalledTimes(1)
  })

  it('does NOT require the token for scoped (userId) reads even in production', async () => {
    vi.stubEnv('AUDIT_ADMIN_TOKEN', 'secret-token')
    const { GET } = await loadRoute()
    const res = await GET(getRequest('?userId=visitor-abc'))
    expect(res.status).toBe(200)
  })

  it('clamps limit to 200 and defaults to 50', async () => {
    const { GET } = await loadRoute()
    await GET(getRequest('?userId=v&limit=99999'))
    await GET(getRequest('?userId=v'))
    expect(findManyMock.mock.calls[0][0].take).toBe(200)
    expect(findManyMock.mock.calls[1][0].take).toBe(50)
  })
})
