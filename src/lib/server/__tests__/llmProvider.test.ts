import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  OLLAMA_DEFAULT_NUM_CTX,
  OPENROUTER_BASE_URL,
  buildChatBody,
  clampContextTokens,
  extractContent,
  extractToolCalls,
  normalizeServerProvider,
  parseProviderSseLine,
  readProviderCtx,
  resolveChatUrlAndHeaders,
  type ProviderCtx,
} from '@/lib/server/llmProvider'

// Shared server-side provider layer for the chat proxy routes. The contract
// under test is byte-compatibility with the historical inline route logic:
// header parsing + guards, per-provider URL/headers, body translation in both
// dialects, and response/SSE extraction.

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/resolve', { headers })
}

function ctxOf(overrides: Partial<ProviderCtx> = {}): ProviderCtx {
  return {
    provider: 'claude',
    apiKey: 'k',
    model: 'claude-sonnet-4-6',
    baseUrl: '',
    contextTokens: 0,
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

// ── readProviderCtx ───────────────────────────────────────────────────────────

describe('readProviderCtx — defaults and normalization', () => {
  it('applies the historical defaults when headers are absent (except the key guard)', () => {
    const result = readProviderCtx(req({ 'x-api-key': 'k' }))
    expect(result).toEqual({
      ok: true,
      ctx: {
        provider: 'claude',
        apiKey: 'k',
        model: 'claude-sonnet-4-6',
        baseUrl: '',
        contextTokens: 0,
      },
    })
  })

  it('reads all five BYOK headers', () => {
    const result = readProviderCtx(
      req({
        'x-api-key': 'sk-or-1',
        'x-provider': 'openrouter',
        'x-model': 'anthropic/claude-sonnet-4.6',
        'x-base-url': 'https://openrouter.ai/api/v1',
        'x-context-tokens': '16384',
      }),
    )
    expect(result).toEqual({
      ok: true,
      ctx: {
        provider: 'openrouter',
        apiKey: 'sk-or-1',
        contextTokens: 16384,
        model: 'anthropic/claude-sonnet-4.6',
        baseUrl: 'https://openrouter.ai/api/v1',
      },
    })
  })

  it('normalizes an unknown provider string to claude (the absent-header default)', () => {
    expect(normalizeServerProvider('groq')).toBe('claude')
    const result = readProviderCtx(req({ 'x-api-key': 'k', 'x-provider': 'groq' }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.ctx.provider).toBe('claude')
  })

  it('accepts each of the four known providers verbatim', () => {
    for (const p of ['claude', 'openai', 'openrouter', 'ollama'] as const) {
      expect(normalizeServerProvider(p)).toBe(p)
    }
  })
})

describe('readProviderCtx — guards', () => {
  it('rejects a missing API key with 401 for non-Ollama providers', () => {
    for (const provider of ['claude', 'openai', 'openrouter']) {
      expect(readProviderCtx(req({ 'x-provider': provider }))).toEqual({
        ok: false,
        error: 'No API key provided',
        status: 401,
      })
    }
  })

  it('allows Ollama without an API key', () => {
    const result = readProviderCtx(req({ 'x-provider': 'ollama' }))
    expect(result.ok).toBe(true)
  })

  it('rejects a bad base URL with 400 in production (validateBaseUrl semantics)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const result = readProviderCtx(
      req({ 'x-api-key': 'k', 'x-base-url': 'http://insecure.example.com' }),
    )
    expect(result).toEqual({
      ok: false,
      error: 'Base URL must use https in production',
      status: 400,
    })
  })

  it('checks the API key before the base URL (401 wins over 400)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const result = readProviderCtx(req({ 'x-base-url': 'http://localhost:11434' }))
    expect(result).toEqual({ ok: false, error: 'No API key provided', status: 401 })
  })
})

// ── resolveChatUrlAndHeaders ──────────────────────────────────────────────────

describe('resolveChatUrlAndHeaders', () => {
  it('claude → Anthropic Messages API with the exact historical headers', () => {
    expect(resolveChatUrlAndHeaders(ctxOf())).toEqual({
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'k',
        'anthropic-version': '2023-06-01',
      },
      kind: 'anthropic',
    })
  })

  it('openai without a base URL → api.openai.com with Bearer auth', () => {
    expect(resolveChatUrlAndHeaders(ctxOf({ provider: 'openai', model: 'gpt-4o' }))).toEqual({
      url: 'https://api.openai.com/v1/chat/completions',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer k' },
      kind: 'openai',
    })
  })

  it('ollama uses the NATIVE /api/chat, not the OpenAI-compatible shim', () => {
    // The shim silently ignores options.num_ctx (measured: /api/ps still
    // reports 4096 after a request asking for 16384), which truncates long
    // prompts with no error. /api/chat honours it — hence a separate dialect.
    const { url, headers, kind } = resolveChatUrlAndHeaders(
      ctxOf({ provider: 'ollama', apiKey: '', model: 'qwen3:8b', baseUrl: 'http://localhost:11434/' }),
    )
    expect(url).toBe('http://localhost:11434/api/chat')
    expect(headers).toEqual({ 'Content-Type': 'application/json' })
    expect(kind).toBe('ollama')
  })

  it('ollama falls back to the local default base when none is supplied', () => {
    const { url } = resolveChatUrlAndHeaders(
      ctxOf({ provider: 'ollama', apiKey: '', model: 'qwen3:8b', baseUrl: '' }),
    )
    expect(url).toBe('http://localhost:11434/api/chat')
  })

  it('openrouter default base already contains /v1 — composed without doubling it', () => {
    const { url, headers, kind } = resolveChatUrlAndHeaders(
      ctxOf({ provider: 'openrouter', apiKey: 'sk-or-1' }),
    )
    expect(OPENROUTER_BASE_URL).toBe('https://openrouter.ai/api/v1')
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer sk-or-1' })
    expect(kind).toBe('openai')
  })

  it('openrouter x-base-url override: appends /v1 only when the base lacks it', () => {
    expect(
      resolveChatUrlAndHeaders(
        ctxOf({ provider: 'openrouter', baseUrl: 'https://proxy.example.com' }),
      ).url,
    ).toBe('https://proxy.example.com/v1/chat/completions')
    expect(
      resolveChatUrlAndHeaders(
        ctxOf({ provider: 'openrouter', baseUrl: 'https://proxy.example.com/api/v1/' }),
      ).url,
    ).toBe('https://proxy.example.com/api/v1/chat/completions')
  })
})

// ── buildChatBody: Anthropic dialect ─────────────────────────────────────────

describe('buildChatBody — anthropic', () => {
  const messages = [
    { role: 'system', content: 'be terse' },
    { role: 'user', content: 'hello' },
  ]

  it('splits the system message out of the messages array', () => {
    expect(buildChatBody(ctxOf(), { messages, maxTokens: 100, temperature: 0.3 })).toEqual({
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      temperature: 0.3,
      system: 'be terse',
      messages: [{ role: 'user', content: 'hello' }],
    })
  })

  it('omits temperature for sampling-rejecting models (Opus 4.7+/Fable 5)', () => {
    const body = buildChatBody(ctxOf({ model: 'claude-fable-5' }), {
      messages,
      maxTokens: 100,
      temperature: 0.3,
    })
    expect(body).not.toHaveProperty('temperature')
    expect(body).toHaveProperty('system', 'be terse')
  })

  it('prefers an explicit system option over splitting', () => {
    const body = buildChatBody(ctxOf(), {
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 50,
      temperature: 0,
      system: 'generation prompt',
    })
    expect(body).toMatchObject({ system: 'generation prompt', temperature: 0 })
  })

  it('omits the system field entirely when there is no system content (classify shape)', () => {
    const body = buildChatBody(ctxOf(), {
      messages: [{ role: 'user', content: 'classify me' }],
      maxTokens: 50,
      temperature: 0,
    })
    expect(body).not.toHaveProperty('system')
  })

  it('passes neutral tools through with tool_choice auto', () => {
    const tools = [{ name: 't', description: 'd', input_schema: { type: 'object' } }]
    expect(
      buildChatBody(ctxOf(), { messages, maxTokens: 2000, temperature: 0.2, tools }),
    ).toMatchObject({ tools, tool_choice: { type: 'auto' } })
  })

  it('sets stream: true only when requested', () => {
    expect(
      buildChatBody(ctxOf(), { messages, maxTokens: 10, temperature: 0, stream: true }),
    ).toMatchObject({ stream: true })
    expect(
      buildChatBody(ctxOf(), { messages, maxTokens: 10, temperature: 0 }),
    ).not.toHaveProperty('stream')
  })
})

// ── buildChatBody: OpenAI dialect ────────────────────────────────────────────

describe('buildChatBody — openai-compatible', () => {
  const ctx = ctxOf({ provider: 'openai', model: 'gpt-4o' })
  const messages = [
    { role: 'system', content: 'be terse' },
    { role: 'user', content: 'hello' },
  ]

  it('keeps messages verbatim with max_tokens/temperature', () => {
    expect(buildChatBody(ctx, { messages, maxTokens: 1000, temperature: 0.3 })).toEqual({
      model: 'gpt-4o',
      max_tokens: 1000,
      temperature: 0.3,
      messages,
    })
  })

  it('keeps temperature even for sampling-rejecting Claude ids routed via OpenRouter', () => {
    const body = buildChatBody(
      ctxOf({ provider: 'openrouter', model: 'anthropic/claude-fable-5' }),
      { messages, maxTokens: 100, temperature: 0.5 },
    )
    expect(body).toMatchObject({ temperature: 0.5 })
  })

  it('adds logprobs + top_logprobs: 5 when requested', () => {
    expect(buildChatBody(ctx, { messages, maxTokens: 10, logprobs: true })).toMatchObject({
      logprobs: true,
      top_logprobs: 5,
    })
    expect(buildChatBody(ctx, { messages, maxTokens: 10 })).not.toHaveProperty('logprobs')
  })

  it('translates neutral tools into the function shape with tool_choice auto', () => {
    const body = buildChatBody(ctx, {
      messages,
      maxTokens: 2000,
      temperature: 0.2,
      tools: [{ name: 'propose_edit', description: 'd', input_schema: { type: 'object' } }],
    })
    expect(body).toMatchObject({
      tools: [
        {
          type: 'function',
          function: { name: 'propose_edit', description: 'd', parameters: { type: 'object' } },
        },
      ],
      tool_choice: 'auto',
    })
  })

  it('prepends an explicit system prompt as a system message (generate shape)', () => {
    const body = buildChatBody(ctx, {
      messages: [{ role: 'user', content: 'write' }],
      maxTokens: 4000,
      temperature: 0.7,
      system: 'gen prompt',
    })
    expect(body).toMatchObject({
      messages: [
        { role: 'system', content: 'gen prompt' },
        { role: 'user', content: 'write' },
      ],
    })
  })
})

// ── extractContent / extractToolCalls ────────────────────────────────────────

describe('extractContent', () => {
  it('anthropic: first content block text, logprobs always null', () => {
    expect(
      extractContent('anthropic', { content: [{ type: 'text', text: 'hello' }] }),
    ).toEqual({ content: 'hello', logprobs: null })
  })

  it('openai: message content plus choice logprobs (null when absent)', () => {
    expect(
      extractContent('openai', { choices: [{ message: { content: 'hi' }, logprobs: { content: [] } }] }),
    ).toEqual({ content: 'hi', logprobs: { content: [] } })
    expect(
      extractContent('openai', { choices: [{ message: { content: 'hi' } }] }),
    ).toEqual({ content: 'hi', logprobs: null })
  })
})

describe('extractToolCalls', () => {
  it('anthropic: filters tool_use blocks to {name, input}', () => {
    expect(
      extractToolCalls('anthropic', {
        content: [
          { type: 'text', text: 'thinking...' },
          { type: 'tool_use', name: 'propose_edit', input: { a: 1 } },
        ],
      }),
    ).toEqual([{ name: 'propose_edit', input: { a: 1 } }])
    expect(extractToolCalls('anthropic', {})).toEqual([])
  })

  it('openai: parses stringified arguments and absorbs malformed JSON as {}', () => {
    expect(
      extractToolCalls('openai', {
        choices: [
          {
            message: {
              tool_calls: [
                { function: { name: 'propose_edit', arguments: '{"a":1}' } },
                { function: { name: 'broken', arguments: '{not json' } },
              ],
            },
          },
        ],
      }),
    ).toEqual([
      { name: 'propose_edit', input: { a: 1 } },
      { name: 'broken', input: {} },
    ])
    expect(extractToolCalls('openai', { choices: [{ message: {} }] })).toEqual([])
  })
})

// ── parseProviderSseLine ─────────────────────────────────────────────────────

describe('parseProviderSseLine', () => {
  // Real line shapes from the historical inline stream parsers.
  it('anthropic: content_block_delta lines yield text deltas', () => {
    const line =
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}'
    expect(parseProviderSseLine('anthropic', line)).toEqual({ text: 'Hello' })
  })

  it('anthropic: non-delta events, event: lines, [DONE], and junk yield null', () => {
    expect(
      parseProviderSseLine('anthropic', 'data: {"type":"message_start","message":{}}'),
    ).toBeNull()
    expect(parseProviderSseLine('anthropic', 'event: content_block_delta')).toBeNull()
    expect(parseProviderSseLine('anthropic', 'data: [DONE]')).toBeNull()
    expect(parseProviderSseLine('anthropic', 'data: {broken')).toBeNull()
    expect(parseProviderSseLine('anthropic', '')).toBeNull()
  })

  it('openai: choices[0].delta.content lines yield text deltas', () => {
    const line =
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hi"}}]}'
    expect(parseProviderSseLine('openai', line)).toEqual({ text: 'Hi' })
  })

  it('openai: empty deltas, [DONE], and malformed lines yield null', () => {
    expect(
      parseProviderSseLine('openai', 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}'),
    ).toBeNull()
    expect(parseProviderSseLine('openai', 'data: [DONE]')).toBeNull()
    expect(parseProviderSseLine('openai', 'data: {broken')).toBeNull()
    expect(parseProviderSseLine('openai', ': keep-alive comment')).toBeNull()
  })
})

// ── /api/embed 501 matrix ────────────────────────────────────────────────────

describe('POST /api/embed — provider support matrix', () => {
  function embedRequest(headers: Record<string, string>, body: unknown = { texts: ['a'] }) {
    return new NextRequest('http://localhost/api/embed', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  }

  async function loadRoute() {
    vi.resetModules()
    return import('@/app/api/embed/route')
  }

  it('claude without a base URL → 501 {reason: "unsupported"}, even with a key', async () => {
    const { POST } = await loadRoute()
    const res = await POST(embedRequest({ 'x-provider': 'claude', 'x-api-key': 'k' }))
    expect(res.status).toBe(501)
    expect(await res.json()).toEqual({ reason: 'unsupported' })
  })

  it('claude without base URL AND without key → still 501 (support gate precedes the 401)', async () => {
    const { POST } = await loadRoute()
    const res = await POST(embedRequest({}))
    expect(res.status).toBe(501)
    expect(await res.json()).toEqual({ reason: 'unsupported' })
  })

  it('openrouter → 501 {reason: "unsupported"} with or without a key', async () => {
    const { POST } = await loadRoute()
    const cases: Record<string, string>[] = [
      { 'x-provider': 'openrouter', 'x-api-key': 'sk-or-1' },
      { 'x-provider': 'openrouter' },
      { 'x-provider': 'openrouter', 'x-api-key': 'sk-or-1', 'x-base-url': 'https://openrouter.ai/api/v1' },
    ]
    for (const headers of cases) {
      const res = await POST(embedRequest(headers))
      expect(res.status).toBe(501)
      expect(await res.json()).toEqual({ reason: 'unsupported' })
    }
  })

  it('openai without a key → 401', async () => {
    const { POST } = await loadRoute()
    const res = await POST(embedRequest({ 'x-provider': 'openai' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'No API key provided' })
  })

  it('ollama needs no key and calls its native /api/embed', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ embeddings: [[0.1, 0.2]] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { POST } = await loadRoute()
    const res = await POST(embedRequest({ 'x-provider': 'ollama' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ vectors: [[0.1, 0.2]] })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:11434/api/embed')
  })

  it('claude WITH a base URL proxies to the OpenAI-compatible embeddings path', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ data: [{ embedding: [1, 2] }] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { POST } = await loadRoute()
    const res = await POST(
      embedRequest({ 'x-provider': 'claude', 'x-api-key': 'k', 'x-base-url': 'https://proxy.example.com' }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ vectors: [[1, 2]] })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://proxy.example.com/v1/embeddings')
  })
})

// ── ollama native dialect ─────────────────────────────────────────────────────
//
// Ollama is the one provider this app talks to over a non-OpenAI wire format.
// Every assertion below pins a behaviour that was MEASURED against a live
// Ollama 0.33.0 running qwen3:8b, because each one is silently wrong on the
// OpenAI-compatibility endpoint the app used before.

describe('buildChatBody — ollama native', () => {
  const ollama = (overrides: Partial<ProviderCtx> = {}) =>
    ctxOf({ provider: 'ollama', apiKey: '', model: 'qwen3:8b', ...overrides })

  it('sends the requested context window as options.num_ctx', () => {
    // The whole reason for this dialect: /v1/chat/completions accepts and then
    // ignores num_ctx, leaving qwen3:8b at 4096 of its 40960 and truncating
    // long prompts with no error.
    const body = buildChatBody(ollama({ contextTokens: 16384 }), {
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect((body.options as Record<string, unknown>).num_ctx).toBe(16384)
  })

  it('falls back to Ollama\'s own default when no context size was requested', () => {
    const body = buildChatBody(ollama({ contextTokens: 0 }), {
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect((body.options as Record<string, unknown>).num_ctx).toBe(OLLAMA_DEFAULT_NUM_CTX)
  })

  it('suppresses chain-of-thought with think: false', () => {
    // Without this a thinking model spends the token budget on reasoning the
    // app has no surface for — and over the OpenAI shim that text goes to a
    // `reasoning` field nothing reads, so `content` comes back empty.
    const body = buildChatBody(ollama(), { messages: [{ role: 'user', content: 'hi' }] })
    expect(body.think).toBe(false)
  })

  it('moves sampling and length into options, not top-level max_tokens', () => {
    const body = buildChatBody(ollama(), {
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 512,
      temperature: 0.3,
    })
    expect(body.max_tokens).toBeUndefined()
    expect(body.options).toMatchObject({ num_predict: 512, temperature: 0.3 })
  })

  it('prepends an explicit system prompt as a system-role message', () => {
    const body = buildChatBody(ollama(), {
      messages: [{ role: 'user', content: 'hi' }],
      system: 'be terse',
    })
    expect(body.messages).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hi' },
    ])
  })

  it('maps neutral tools to the nested function shape without tool_choice', () => {
    const body = buildChatBody(ollama(), {
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'link_blocks', description: 'd', input_schema: { type: 'object' } }],
    })
    expect(body.tools).toEqual([
      { type: 'function', function: { name: 'link_blocks', description: 'd', parameters: { type: 'object' } } },
    ])
    expect(body.tool_choice).toBeUndefined()
  })

  it('never asks for logprobs — Ollama exposes none', () => {
    const body = buildChatBody(ollama(), {
      messages: [{ role: 'user', content: 'hi' }],
      logprobs: true,
    })
    expect(body.logprobs).toBeUndefined()
  })
})

describe('clampContextTokens', () => {
  it('treats 0, negative and non-finite requests as unset', () => {
    expect(clampContextTokens(0)).toBe(OLLAMA_DEFAULT_NUM_CTX)
    expect(clampContextTokens(-1)).toBe(OLLAMA_DEFAULT_NUM_CTX)
    expect(clampContextTokens(Number.NaN)).toBe(OLLAMA_DEFAULT_NUM_CTX)
  })

  it('clamps to the guard bounds rather than trusting a malformed header', () => {
    expect(clampContextTokens(10)).toBe(1024)
    expect(clampContextTokens(9_999_999)).toBe(131072)
  })

  it('passes a sane request through untouched', () => {
    expect(clampContextTokens(16384)).toBe(16384)
  })
})

describe('extractContent / extractToolCalls — ollama', () => {
  it('reads content from message.content', () => {
    expect(extractContent('ollama', { message: { role: 'assistant', content: 'OK.' } })).toEqual({
      content: 'OK.',
      logprobs: null,
    })
  })

  it('returns empty content rather than throwing on a malformed response', () => {
    expect(extractContent('ollama', {})).toEqual({ content: '', logprobs: null })
  })

  it('reads tool arguments that arrive already parsed as an object', () => {
    // Measured: Ollama returns `arguments` as an object, unlike OpenAI's
    // JSON-encoded string. Parsing it again would throw on every call.
    const calls = extractToolCalls('ollama', {
      message: {
        tool_calls: [{ function: { name: 'link_blocks', arguments: { from: 'a', to: 'b' } } }],
      },
    })
    expect(calls).toEqual([{ name: 'link_blocks', input: { from: 'a', to: 'b' } }])
  })

  it('still absorbs a string-encoded argument, malformed or not', () => {
    const calls = extractToolCalls('ollama', {
      message: {
        tool_calls: [
          { function: { name: 'ok', arguments: '{"x":1}' } },
          { function: { name: 'bad', arguments: '{not json' } },
        ],
      },
    })
    expect(calls).toEqual([
      { name: 'ok', input: { x: 1 } },
      { name: 'bad', input: {} },
    ])
  })

  it('returns no calls when the response carries none', () => {
    expect(extractToolCalls('ollama', { message: { content: 'hi' } })).toEqual([])
  })
})

describe('parseProviderSseLine — ollama NDJSON', () => {
  it('reads a bare JSON line with no data: prefix', () => {
    const line = '{"model":"qwen3:8b","message":{"role":"assistant","content":"It"},"done":false}'
    expect(parseProviderSseLine('ollama', line)).toEqual({ text: 'It' })
  })

  it('ignores the terminal done frame, which carries no content', () => {
    expect(parseProviderSseLine('ollama', '{"done":true,"message":{"content":""}}')).toBeNull()
  })

  it('drops a thinking delta so a model ignoring think:false cannot leak reasoning', () => {
    expect(
      parseProviderSseLine('ollama', '{"message":{"thinking":"Okay, the user"},"done":false}'),
    ).toBeNull()
  })

  it('ignores blank lines and malformed JSON', () => {
    expect(parseProviderSseLine('ollama', '')).toBeNull()
    expect(parseProviderSseLine('ollama', '   ')).toBeNull()
    expect(parseProviderSseLine('ollama', '{not json')).toBeNull()
  })

  it('does not accept an SSE-framed line — that is the other dialects\' format', () => {
    expect(parseProviderSseLine('ollama', 'data: {"message":{"content":"x"}}')).toBeNull()
  })
})
