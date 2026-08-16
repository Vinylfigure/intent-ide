import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { callLLM, callLLMWithLogprobs, streamLLM, type LLMConfig, type LLMMessage } from '../client'
import { providerHeaders } from '../providerHeaders'
import { getSessionEstimate, resetSessionEstimate } from '../spendEstimate'

const config: LLMConfig = { provider: 'claude', apiKey: 'k', model: 'm' }
const messages: LLMMessage[] = [{ role: 'user', content: 'hello world, count me' }]

beforeEach(() => {
  resetSessionEstimate()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ content: 'ok', logprobs: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('client spend accounting (soft indicator coverage)', () => {
  it('callLLM counts the outbound payload chars', async () => {
    await callLLM(messages, config)
    expect(getSessionEstimate()).toBeGreaterThan(0)
  })

  it('callLLMWithLogprobs counts the outbound payload chars', async () => {
    await callLLMWithLogprobs(messages, config)
    expect(getSessionEstimate()).toBeGreaterThan(0)
  })

  it('streamLLM counts the outbound payload chars', async () => {
    for await (const _chunk of streamLLM(messages, config)) {
      // drain
    }
    expect(getSessionEstimate()).toBeGreaterThan(0)
  })
})

describe('providerHeaders', () => {
  it('builds the BYOK header block, omitting x-base-url when unset', () => {
    expect(providerHeaders(config)).toEqual({
      'x-api-key': 'k',
      'x-provider': 'claude',
      'x-model': 'm',
    })
  })

  it('includes x-base-url only when the config carries one', () => {
    expect(
      providerHeaders({ provider: 'ollama', apiKey: '', model: 'llama3.2', baseUrl: 'http://localhost:11434' }),
    ).toEqual({
      'x-api-key': '',
      'x-provider': 'ollama',
      'x-model': 'llama3.2',
      'x-base-url': 'http://localhost:11434',
    })
    // Empty string counts as unset — same conditional-spread semantics as the
    // historical inline blocks.
    expect(
      providerHeaders({ provider: 'openai', apiKey: 'k', model: 'gpt-4o', baseUrl: '' }),
    ).not.toHaveProperty('x-base-url')
  })

  it('is exactly what callLLM sends alongside Content-Type', async () => {
    const orConfig: LLMConfig = {
      provider: 'openrouter',
      apiKey: 'sk-or-1',
      model: 'anthropic/claude-sonnet-4.6',
      baseUrl: 'https://openrouter.ai/api/v1',
    }
    await callLLM(messages, orConfig)
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      ...providerHeaders(orConfig),
    })
  })
})
