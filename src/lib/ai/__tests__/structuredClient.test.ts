import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LLMConfig } from '@/stores/settingsStore'
import { fetchStructured, fetchWithRetry } from '@/lib/ai/structuredClient'

const CONFIG: LLMConfig = { provider: 'claude', apiKey: 'test-key', model: 'test-model' }

const REQ = { messages: [{ role: 'user', content: 'hi' }], tools: [] }

// Tiny backoff so retry paths run in milliseconds.
const FAST = { baseDelayMs: 1 }

function response(status: number, body: unknown = { toolCalls: [] }): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchWithRetry', () => {
  it('retries 429s and succeeds on a later attempt (429 → 429 → 200)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(200))
    vi.stubGlobal('fetch', fetchMock)

    const res = await fetchWithRetry('/api/structured', {}, FAST)
    expect(res.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('throws immediately on 400 without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(400))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchWithRetry('/api/structured', {}, FAST)).rejects.toThrow(
      'structured call failed: 400',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws after exhausting retries on persistent 500s (three attempts total)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(500))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchWithRetry('/api/structured', {}, FAST)).rejects.toThrow(
      'structured call failed: 500',
    )
    expect(fetchMock).toHaveBeenCalledTimes(3) // initial + retries=2
  })

  it('retries network errors and can recover', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(response(200))
    vi.stubGlobal('fetch', fetchMock)

    const res = await fetchWithRetry('/api/structured', {}, FAST)
    expect(res.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('rethrows the network error once retries are exhausted', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchWithRetry('/api/structured', {}, FAST)).rejects.toThrow('ECONNRESET')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('honors a custom retry budget', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(503))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      fetchWithRetry('/api/structured', {}, { ...FAST, retries: 0 }),
    ).rejects.toThrow('structured call failed: 503')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('fetchStructured (through the retry layer)', () => {
  it('returns tool calls on success and sends provider headers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response(200, { toolCalls: [{ name: 'verdict', input: {} }] }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await fetchStructured(REQ, CONFIG)
    expect(res.toolCalls).toEqual([{ name: 'verdict', input: {} }])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/structured')
    expect((init.headers as Record<string, string>)['x-provider']).toBe('claude')
  })

  it('throws on a non-retryable HTTP failure instead of returning empty tool calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(401))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchStructured(REQ, CONFIG)).rejects.toThrow('structured call failed: 401')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('normalizes a malformed body to empty tool calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, { nope: true }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await fetchStructured(REQ, CONFIG)
    expect(res.toolCalls).toEqual([])
  })
})
