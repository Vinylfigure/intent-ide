import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { callLLM, callLLMWithLogprobs, streamLLM, type LLMConfig, type LLMMessage } from '../client'
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
