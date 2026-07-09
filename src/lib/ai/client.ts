import { addEstimate } from './spendEstimate'

export type LLMProvider = 'claude' | 'openai' | 'ollama'

export interface LLMConfig {
  provider: LLMProvider
  apiKey: string
  model: string
  baseUrl?: string
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMRequestOptions {
  maxTokens?: number
  temperature?: number
  stream?: boolean
  logprobs?: boolean
}

export interface LLMResponse {
  content: string
  logprobs: import('./uncertainty').LogprobsResult | null
}

// Function to call LLM via our API routes (keeps keys on client, routes proxy)
export async function callLLM(
  messages: LLMMessage[],
  config: LLMConfig,
  options: LLMRequestOptions = {},
): Promise<string> {
  const body = JSON.stringify({ messages, ...options })
  // Soft spend indicator (display only) — resolve/classify traffic counts too.
  addEstimate(body.length)
  const response = await fetch('/api/resolve', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'x-provider': config.provider,
      'x-model': config.model,
      ...(config.baseUrl ? { 'x-base-url': config.baseUrl } : {}),
    },
    body,
  })

  if (!response.ok) {
    throw new Error(`LLM call failed: ${response.statusText}`)
  }

  if (options.stream && response.body) {
    // Return collected stream text
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let result = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      result += decoder.decode(value, { stream: true })
    }
    return result
  }

  const data = await response.json()
  return data.content
}

/**
 * Call LLM and return full response including logprobs (if available).
 * Logprobs are only returned by OpenAI-compatible providers.
 * Claude returns logprobs: null.
 */
export async function callLLMWithLogprobs(
  messages: LLMMessage[],
  config: LLMConfig,
  options: Omit<LLMRequestOptions, 'stream'> = {},
): Promise<LLMResponse> {
  const body = JSON.stringify({ messages, ...options, logprobs: true })
  addEstimate(body.length)
  const response = await fetch('/api/resolve', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'x-provider': config.provider,
      'x-model': config.model,
      ...(config.baseUrl ? { 'x-base-url': config.baseUrl } : {}),
    },
    body,
  })

  if (!response.ok) {
    throw new Error(`LLM call failed: ${response.statusText}`)
  }

  const data = await response.json()
  return {
    content: data.content,
    logprobs: data.logprobs ?? null,
  }
}

// Streaming version that yields chunks
export async function* streamLLM(
  messages: LLMMessage[],
  config: LLMConfig,
  options: LLMRequestOptions = {},
): AsyncGenerator<string> {
  const body = JSON.stringify({ messages, ...options, stream: true })
  addEstimate(body.length)
  const response = await fetch('/api/resolve', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'x-provider': config.provider,
      'x-model': config.model,
      ...(config.baseUrl ? { 'x-base-url': config.baseUrl } : {}),
    },
    body,
  })

  if (!response.ok) {
    throw new Error(`LLM call failed: ${response.statusText}`)
  }

  if (!response.body) {
    throw new Error('No response body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    yield decoder.decode(value, { stream: true })
  }
}
