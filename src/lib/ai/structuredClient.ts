import type { LLMConfig } from '@/stores/settingsStore'

/**
 * Injectable client for the provider-agnostic `/api/structured` tool-calling
 * endpoint. Everything that talks to the model for graph extraction or cascade
 * proposals takes a `CallStructuredFn` defaulting to `fetchStructured`, so
 * tests and the eval harness can run the real traversal/gating/anchoring
 * pipeline with scripted responses — no network, no fetch mocking.
 */

export interface NeutralTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface StructuredMessage {
  role: string
  content: string
}

export interface StructuredRequest {
  messages: StructuredMessage[]
  tools: NeutralTool[]
  maxTokens?: number
  temperature?: number
}

export interface StructuredToolCall {
  name: string
  input: unknown
}

export type CallStructuredFn = (
  req: StructuredRequest,
  config: LLMConfig,
) => Promise<{ toolCalls: StructuredToolCall[] }>

export interface RetryOptions {
  /** Additional attempts after the first (default 2 → up to 3 requests total). */
  retries?: number
  baseDelayMs?: number
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * fetch with jittered exponential backoff for transient failures: 429,
 * 5xx, and network errors are retried (delay = baseDelayMs * 4^attempt *
 * (0.5 + random)); any other non-ok status throws immediately — a 400 will
 * not get better on the second try. After exhausting retries the last
 * failure throws. HTTP failure must THROW, not masquerade as an empty
 * tool-call response: callers distinguish "the model chose to call nothing"
 * (valid, cacheable) from "the provider is down" (must not poison caches).
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: RetryOptions = {},
): Promise<Response> {
  const retries = opts.retries ?? 2
  const baseDelayMs = opts.baseDelayMs ?? 300
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null
    try {
      res = await fetch(url, init)
    } catch (err) {
      // Network error — retryable.
      if (attempt >= retries) throw err
    }
    if (res) {
      if (res.ok) return res
      const retryable = res.status === 429 || res.status >= 500
      if (!retryable || attempt >= retries) {
        throw new Error(`structured call failed: ${res.status}`)
      }
    }
    await sleep(baseDelayMs * 4 ** attempt * (0.5 + Math.random()))
  }
}

export const fetchStructured: CallStructuredFn = async (req, config) => {
  const res = await fetchWithRetry('/api/structured', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'x-provider': config.provider,
      'x-model': config.model,
      ...(config.baseUrl ? { 'x-base-url': config.baseUrl } : {}),
    },
    body: JSON.stringify(req),
  })
  const data = await res.json()
  return { toolCalls: Array.isArray(data.toolCalls) ? data.toolCalls : [] }
}
