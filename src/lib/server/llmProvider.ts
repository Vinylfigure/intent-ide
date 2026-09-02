import { modelRejectsSampling } from '@/lib/ai/modelCapabilities'
import { validateBaseUrl } from '@/lib/server/validateBaseUrl'

/**
 * Server-side provider layer shared by the chat proxy routes
 * (/api/classify, /api/resolve, /api/structured, /api/generate) and adopted
 * by /api/embed for header/guard parsing.
 *
 * Centralizes the per-provider branching that used to be duplicated inline in
 * each route: BYOK header parsing + guards, chat endpoint/header resolution,
 * request-body translation (Anthropic vs OpenAI-compatible dialects), and
 * response/SSE extraction. Route-visible behavior (status codes, response
 * shapes, SSE envelope) is unchanged.
 */

export type ServerProvider = 'claude' | 'openai' | 'openrouter' | 'ollama'

export interface ProviderCtx {
  provider: ServerProvider
  apiKey: string
  model: string
  baseUrl: string
  /**
   * Requested context window in tokens (Ollama `num_ctx`). 0 means "unset —
   * use the server's default". Only the ollama dialect consumes this: hosted
   * providers size their own window and reject the field.
   */
  contextTokens: number
}

const SERVER_PROVIDERS: readonly string[] = ['claude', 'openai', 'openrouter', 'ollama']

/** OpenRouter's public base URL (already includes the /v1 segment). */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

/** Where a local Ollama listens when the client sends no base URL. */
export const OLLAMA_BASE_URL = 'http://localhost:11434'

/**
 * Ollama's own default context window. Measured, not assumed: a request to
 * `/v1/chat/completions` carrying `options.num_ctx` is SILENTLY IGNORED by the
 * OpenAI-compatibility layer — `GET /api/ps` still reports 4096 afterwards,
 * while `qwen3:8b` advertises 40960. An over-long prompt is then truncated
 * with no error and the model answers confidently from half the evidence.
 * That is the whole reason this dialect exists rather than reusing the
 * OpenAI-compatible branch; `/api/chat` honours `options.num_ctx`.
 */
export const OLLAMA_DEFAULT_NUM_CTX = 4096

/**
 * Bounds for a client-supplied context request. The ceiling is a guard against
 * a malformed header, not a model limit — Ollama itself clamps `num_ctx` down
 * to whatever the loaded model was trained for, so asking for more than the
 * model supports is safe and asking for less is honoured exactly.
 */
export const OLLAMA_MIN_NUM_CTX = 1024
export const OLLAMA_MAX_NUM_CTX = 131072

/** Clamp a requested context size; 0/NaN/absent falls back to `fallback`. */
export function clampContextTokens(requested: number, fallback = OLLAMA_DEFAULT_NUM_CTX): number {
  if (!Number.isFinite(requested) || requested <= 0) return fallback
  return Math.min(OLLAMA_MAX_NUM_CTX, Math.max(OLLAMA_MIN_NUM_CTX, Math.floor(requested)))
}

/**
 * Normalize the x-provider header. Anything outside the four known providers
 * falls back to 'claude' — the same default an absent header gets.
 *
 * NOTE: this is a deliberate behavior change from the pre-provider-module
 * inline routes, where an unknown x-provider value fell through to the
 * OpenAI-compatible branch. Unknown now means "treat as the default provider
 * (claude)", matching what an absent header does.
 */
export function normalizeServerProvider(raw: string): ServerProvider {
  return SERVER_PROVIDERS.includes(raw) ? (raw as ServerProvider) : 'claude'
}

/**
 * Read the BYOK headers (x-api-key / x-provider / x-model / x-base-url) and
 * run the shared guards: non-Ollama providers require an API key (401), and
 * the client-supplied base URL must pass validateBaseUrl (400).
 *
 * `x-context-tokens` is optional and advisory: an absent or unparseable value
 * becomes 0, which every dialect reads as "use the default".
 */
export function readProviderCtx(
  request: Request,
): { ok: true; ctx: ProviderCtx } | { ok: false; error: string; status: number } {
  const apiKey = request.headers.get('x-api-key') || ''
  const provider = normalizeServerProvider(request.headers.get('x-provider') || 'claude')
  const model = request.headers.get('x-model') || 'claude-sonnet-4-6'
  const baseUrl = request.headers.get('x-base-url') || ''
  const contextTokens = Number.parseInt(request.headers.get('x-context-tokens') || '', 10)

  // Only require API key for non-Ollama providers
  if (provider !== 'ollama' && !apiKey) {
    return { ok: false, error: 'No API key provided', status: 401 }
  }

  const baseUrlError = validateBaseUrl(baseUrl)
  if (baseUrlError) {
    return { ok: false, error: baseUrlError, status: 400 }
  }

  return {
    ok: true,
    ctx: {
      provider,
      apiKey,
      model,
      baseUrl,
      contextTokens: Number.isFinite(contextTokens) ? contextTokens : 0,
    },
  }
}

/**
 * Resolve the chat-completions URL and auth headers for the provider.
 *
 * - claude     → Anthropic Messages API with x-api-key + anthropic-version.
 * - openrouter → baseUrl override or OPENROUTER_BASE_URL; the default already
 *                ends in /v1, so /v1 is only appended when missing.
 * - ollama     → the NATIVE `${baseUrl}/api/chat`, not the OpenAI-compatible
 *                shim. The shim silently drops `options.num_ctx` (leaving the
 *                model at Ollama's 4096 default however large its real window)
 *                and routes a thinking model's tokens into a `reasoning` field
 *                the caller never reads, so `message.content` can come back
 *                empty. `/api/chat` honours both `options` and `think`.
 * - openai     → byte-identical to the historical inline composition:
 *                `${baseUrl}/v1/chat/completions` or api.openai.com.
 */
export type ProviderDialect = 'anthropic' | 'openai' | 'ollama'

export function resolveChatUrlAndHeaders(ctx: ProviderCtx): {
  url: string
  headers: Record<string, string>
  kind: ProviderDialect
} {
  if (ctx.provider === 'claude') {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ctx.apiKey,
        'anthropic-version': '2023-06-01',
      },
      kind: 'anthropic',
    }
  }

  if (ctx.provider === 'ollama') {
    const base = (ctx.baseUrl || OLLAMA_BASE_URL).replace(/\/$/, '')
    return {
      url: `${base}/api/chat`,
      headers: {
        'Content-Type': 'application/json',
        ...(ctx.apiKey ? { Authorization: `Bearer ${ctx.apiKey}` } : {}),
      },
      kind: 'ollama',
    }
  }

  let url: string
  if (ctx.provider === 'openrouter') {
    const base = (ctx.baseUrl || OPENROUTER_BASE_URL).replace(/\/$/, '')
    url = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`
  } else {
    // OpenAI-compatible
    url = ctx.baseUrl
      ? `${ctx.baseUrl.replace(/\/$/, '')}/v1/chat/completions`
      : 'https://api.openai.com/v1/chat/completions'
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (ctx.apiKey) {
    headers['Authorization'] = `Bearer ${ctx.apiKey}`
  }
  return { url, headers, kind: 'openai' }
}

/** Neutral (Anthropic-shaped) tool definition, as accepted by /api/structured. */
export interface NeutralChatTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface ChatMessage {
  role: string
  content: string
}

export interface ChatBodyOptions {
  messages: ChatMessage[]
  maxTokens?: number
  temperature?: number
  stream?: boolean
  logprobs?: boolean
  tools?: NeutralChatTool[]
  /** Explicit system prompt; when absent, a 'system'-role message is split out. */
  system?: string
}

/**
 * Translate a neutral chat request into the provider's native body.
 *
 * Anthropic: system split out of messages, sampling params omitted for models
 * that reject them (modelRejectsSampling), neutral tools passed through with
 * tool_choice { type: 'auto' }.
 *
 * Ollama (native /api/chat): sampling and sizing move into `options`
 * (num_ctx / temperature / num_predict) and `think: false` suppresses a
 * thinking model's chain of thought. No logprobs — Ollama exposes none.
 *
 * OpenAI-compatible: max_tokens/temperature/messages verbatim, logprobs +
 * top_logprobs: 5 when requested, tools mapped to the function shape with
 * tool_choice 'auto'.
 */
export function buildChatBody(ctx: ProviderCtx, opts: ChatBodyOptions): Record<string, unknown> {
  if (ctx.provider === 'claude') {
    const system = opts.system ?? (opts.messages.find((m) => m.role === 'system')?.content || '')
    const userMessages = opts.messages.filter((m) => m.role !== 'system')
    return {
      model: ctx.model,
      max_tokens: opts.maxTokens,
      // Opus 4.7+/Fable 5 reject sampling params with a 400 — omit there.
      ...(modelRejectsSampling(ctx.model) || opts.temperature === undefined
        ? {}
        : { temperature: opts.temperature }),
      ...(system ? { system } : {}),
      messages: userMessages,
      ...(opts.tools
        ? {
            tools: opts.tools,
            // Encourage but don't force — the model may legitimately propose zero edits.
            tool_choice: { type: 'auto' },
          }
        : {}),
      ...(opts.stream ? { stream: true } : {}),
    }
  }

  const messages = opts.system
    ? [{ role: 'system', content: opts.system }, ...opts.messages]
    : opts.messages

  if (ctx.provider === 'ollama') {
    return {
      model: ctx.model,
      messages,
      stream: !!opts.stream,
      // Reasoning off at the source. qwen3-class models otherwise spend the
      // token budget on a chain of thought this app has no surface for, and
      // over the OpenAI shim that text lands in a `reasoning` field nothing
      // reads — an answer that arrives blank or truncated for no visible
      // reason. Models without a thinking mode ignore the field.
      think: false,
      options: {
        num_ctx: clampContextTokens(ctx.contextTokens),
        ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
        ...(opts.maxTokens === undefined ? {} : { num_predict: opts.maxTokens }),
      },
      // Ollama accepts OpenAI's nested function shape and returns
      // `arguments` already parsed as an object (see extractToolCalls).
      ...(opts.tools
        ? {
            tools: opts.tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.input_schema },
            })),
          }
        : {}),
    }
  }

  return {
    model: ctx.model,
    max_tokens: opts.maxTokens,
    ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
    messages,
    // Request logprobs if the caller asked for them (OpenAI supports this)
    ...(opts.logprobs ? { logprobs: true, top_logprobs: 5 } : {}),
    ...(opts.tools
      ? {
          tools: opts.tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.input_schema },
          })),
          tool_choice: 'auto',
        }
      : {}),
    ...(opts.stream ? { stream: true } : {}),
  }
}

/** Extract text content + logprobs from a non-streaming provider response. */
export function extractContent(
  kind: ProviderDialect,
  // Loosely typed: provider response JSON, validated only where read.
  data: any, // eslint-disable-line
): { content: string; logprobs: unknown | null } {
  if (kind === 'anthropic') {
    // Claude does not support logprobs — return null
    return { content: data.content[0].text, logprobs: null }
  }
  if (kind === 'ollama') {
    return { content: data?.message?.content ?? '', logprobs: null }
  }
  const choice = data.choices[0]
  return { content: choice.message.content, logprobs: choice.logprobs ?? null }
}

/** Extract tool calls, absorbing malformed OpenAI `arguments` JSON as {}. */
export function extractToolCalls(
  kind: ProviderDialect,
  // Loosely typed: provider response JSON, validated only where read.
  data: any, // eslint-disable-line
): { name: string; input: unknown }[] {
  if (kind === 'anthropic') {
    return (data.content || [])
      .filter((b: { type: string }) => b.type === 'tool_use')
      .map((b: { name: string; input: unknown }) => ({ name: b.name, input: b.input }))
  }
  if (kind === 'ollama') {
    // Ollama hands back `arguments` already parsed. Tolerate a string anyway:
    // absorbing malformed JSON as {} mirrors the OpenAI branch below rather
    // than failing a whole extraction pass on one bad call.
    const calls = data?.message?.tool_calls || []
    return calls.map((c: { function: { name: string; arguments: unknown } }) => {
      const raw = c.function?.arguments
      if (typeof raw !== 'string') return { name: c.function?.name, input: raw ?? {} }
      try {
        return { name: c.function?.name, input: JSON.parse(raw) }
      } catch {
        return { name: c.function?.name, input: {} }
      }
    })
  }
  const rawCalls = data.choices?.[0]?.message?.tool_calls || []
  return rawCalls.map((c: { function: { name: string; arguments: string } }) => {
    let input: unknown = {}
    try {
      input = JSON.parse(c.function.arguments)
    } catch {
      input = {}
    }
    return { name: c.function.name, input }
  })
}

/**
 * Parse one line of the provider's stream into a text delta.
 * Returns null for anything that is not a text delta (comments, [DONE],
 * malformed JSON, event: lines, non-delta events).
 *
 * Two wire formats, one line-oriented reader: Anthropic and OpenAI both send
 * SSE (`data: {...}`), while Ollama's native /api/chat streams bare NDJSON —
 * one JSON object per line, no `data:` prefix and no [DONE] sentinel. Callers
 * split on newlines either way, so the difference lives here.
 */
export function parseProviderSseLine(
  kind: ProviderDialect,
  line: string,
): { text?: string } | null {
  if (kind === 'ollama') {
    const trimmed = line.trim()
    if (!trimmed) return null
    try {
      const event = JSON.parse(trimmed)
      // `thinking` deltas are deliberately dropped: think:false suppresses them
      // at the source, and a model that ignores the flag must not leak its
      // chain of thought into the answer body.
      const delta = event?.message?.content
      return typeof delta === 'string' && delta ? { text: delta } : null
    } catch {
      return null
    }
  }
  if (!line.startsWith('data: ')) return null
  const payload = line.slice(6).trim()
  if (payload === '[DONE]') return null

  try {
    const event = JSON.parse(payload)
    if (kind === 'anthropic') {
      if (event.type === 'content_block_delta' && event.delta?.text) {
        return { text: event.delta.text }
      }
      return null
    }
    const delta = event.choices?.[0]?.delta?.content
    return delta ? { text: delta } : null
  } catch {
    // Ignore malformed JSON lines
    return null
  }
}
