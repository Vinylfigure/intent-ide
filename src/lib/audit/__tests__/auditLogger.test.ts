import { afterEach, describe, expect, it, vi } from 'vitest'
import { getVisitorId, logAuditEvent, type AuditEventParams } from '@/lib/audit/auditLogger'

// getVisitorId() is the anonymous per-browser identity used to scope each
// visitor's audit trail on the shared public deployment. Contract:
//   - no localStorage (SSR / node)      -> 'local'
//   - storage throws (quota, disabled)  -> 'local' (never throws)
//   - otherwise: generate UUID once, persist under 'intent-ide-visitor-id',
//     and return the SAME id on every subsequent call.

const VISITOR_ID_KEY = 'intent-ide-visitor-id'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

class MemoryStorage {
  private store = new Map<string, string>()

  getItem(key: string) {
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.store.set(key, value)
  }

  removeItem(key: string) {
    this.store.delete(key)
  }

  clear() {
    this.store.clear()
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getVisitorId', () => {
  it("returns 'local' when localStorage does not exist (SSR safety)", () => {
    vi.stubGlobal('localStorage', undefined)
    expect(getVisitorId()).toBe('local')
  })

  it('generates a UUID, persists it, and returns it', () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)

    const id = getVisitorId()
    expect(id).toMatch(UUID_RE)
    expect(storage.getItem(VISITOR_ID_KEY)).toBe(id)
  })

  it('is stable across calls (same id every time)', () => {
    vi.stubGlobal('localStorage', new MemoryStorage())

    const first = getVisitorId()
    const second = getVisitorId()
    const third = getVisitorId()
    expect(second).toBe(first)
    expect(third).toBe(first)
  })

  it('returns a pre-existing stored id without regenerating', () => {
    const storage = new MemoryStorage()
    storage.setItem(VISITOR_ID_KEY, 'existing-visitor-id')
    vi.stubGlobal('localStorage', storage)

    expect(getVisitorId()).toBe('existing-visitor-id')
    expect(storage.getItem(VISITOR_ID_KEY)).toBe('existing-visitor-id')
  })

  it("falls back to 'local' when getItem throws (storage disabled)", () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError: storage disabled')
      },
      setItem: () => {},
    })
    expect(getVisitorId()).toBe('local')
  })

  it("falls back to 'local' when setItem throws (quota exceeded) instead of throwing", () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    })
    expect(() => getVisitorId()).not.toThrow()
    expect(getVisitorId()).toBe('local')
  })
})

// logAuditEvent must attach the visitor id as userId on every write unless the
// caller supplied an explicit userId, and must stay fire-and-forget safe.

function makeParams(overrides: Partial<AuditEventParams> = {}): AuditEventParams {
  return {
    modelName: 'claude-sonnet-4-6',
    modelVersion: '2026-01-01',
    promptVersion: 'v1',
    promptHash: 'abc',
    queryClassification: 'EDIT',
    sourceDocuments: '[]',
    confidenceScore: null,
    responseId: 'resp-1',
    outputType: 'RESOLUTION',
    ...overrides,
  }
}

describe('logAuditEvent visitor scoping', () => {
  it('injects the visitor id as userId when none is supplied', async () => {
    const storage = new MemoryStorage()
    storage.setItem(VISITOR_ID_KEY, 'visitor-123')
    vi.stubGlobal('localStorage', storage)

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'audit-1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await logAuditEvent(makeParams())

    expect(result).toBe('audit-1')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.action).toBe('log')
    expect(body.userId).toBe('visitor-123')
  })

  it('preserves an explicitly supplied userId', async () => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'audit-2' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await logAuditEvent(makeParams({ userId: 'explicit-user' }))

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.userId).toBe('explicit-user')
  })

  it('returns null (never throws) on a non-ok response', async () => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, statusText: 'Too Many Requests' }),
    )

    await expect(logAuditEvent(makeParams())).resolves.toBeNull()
  })

  it('returns null (never throws) when fetch rejects', async () => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    await expect(logAuditEvent(makeParams())).resolves.toBeNull()
  })
})
