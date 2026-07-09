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

export const fetchStructured: CallStructuredFn = async (req, config) => {
  const res = await fetch('/api/structured', {
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
  if (!res.ok) return { toolCalls: [] }
  const data = await res.json()
  return { toolCalls: Array.isArray(data.toolCalls) ? data.toolCalls : [] }
}
