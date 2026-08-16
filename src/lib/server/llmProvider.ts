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
}

const SERVER_PROVIDERS: readonly string[] = ['claude', 'openai', 'openrouter', 'ollama']

/** OpenRouter's public base URL (already includes the /v1 segment). */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

/**
 * Normalize the x-provider header. Anything outside the four known providers
 * falls back to 'claude' — the same default an absent header gets.
 */
export function normalizeServerProvider(raw: string): ServerProvider {
  return SERVER_PROVIDERS.includes(raw) ? (raw as ServerProvider) : 'claude'
}

/**
 * Read the BYOK headers (x-api-key / x-provider / x-model / x-base-url) and
 * run the shared guards: non-Ollama providers require an API key (401), and
 * the client-supplied base URL must pass validateBaseUrl (400).
 */
export function readProviderCtx(
  request: Request,
): { ok: true; ctx: ProviderCtx } | { ok: false; error: string; status: number } {
  const apiKey = request.headers.get('x-api-key') || ''
  const provider = normalizeServerProvider(request.headers.get('x-provider') || 'claude')
  const model = request.headers.get('x-model') || 'claude-sonnet-4-6'
  const baseUrl = request.headers.get('x-base-url') || ''

  // Only require API key for non-Ollama providers
  if (provider !== 'ollama' && !apiKey) {
    return { ok: false, error: 'No API key provided', status: 401 }
  }

  const baseUrlError = validateBaseUrl(baseUrl)
  if (baseUrlError) {
    return { ok: false, error: baseUrlError, status: 400 }
  }

  return { ok: true, ctx: { provider, apiKey, model, baseUrl } }
}

/**
 * Resolve the chat-completions URL and auth headers for the provider.
 *
 * - claude     → Anthropic Messages API with x-api-key + anthropic-version.
 * - openrouter → baseUrl override or OPENROUTER_BASE_URL; the default already
 *                ends in /v1, so /v1 is only appended when missing.
 * - openai / ollama → byte-identical to the historical inline composition:
 *                `${baseUrl}/v1/chat/completions` or api.openai.com.
 */
export function resolveChatUrlAndHeaders(ctx: ProviderCtx): {
  url: string
  headers: Record<string, string>
  kind: 'anthropic' | 'openai'
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

  let url: string
  if (ctx.provider === 'openrouter') {
    const base = (ctx.baseUrl || OPENROUTER_BASE_URL).replace(/\/$/, '')
    url = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`
  } else {
    // OpenAI-compatible (OpenAI or Ollama)
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
  kind: 'anthropic' | 'openai',
  // Loosely typed: provider response JSON, validated only where read.
  data: any, // eslint-disable-line
): { content: string; logprobs: unknown | null } {
  if (kind === 'anthropic') {
    // Claude does not support logprobs — return null
    return { content: data.content[0].text, logprobs: null }
  }
  const choice = data.choices[0]
  return { content: choice.message.content, logprobs: choice.logprobs ?? null }
}

/** Extract tool calls, absorbing malformed OpenAI `arguments` JSON as {}. */
export function extractToolCalls(
  kind: 'anthropic' | 'openai',
  // Loosely typed: provider response JSON, validated only where read.
  data: any, // eslint-disable-line
): { name: string; input: unknown }[] {
  if (kind === 'anthropic') {
    return (data.content || [])
      .filter((b: { type: string }) => b.type === 'tool_use')
      .map((b: { name: string; input: unknown }) => ({ name: b.name, input: b.input }))
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
 * Parse one line of the provider's SSE stream into a text delta.
 * Returns null for anything that is not a text delta (comments, [DONE],
 * malformed JSON, event: lines, non-delta events).
 */
export function parseProviderSseLine(
  kind: 'anthropic' | 'openai',
  line: string,
): { text?: string } | null {
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
