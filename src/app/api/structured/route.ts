import { NextRequest, NextResponse } from 'next/server'
import {
  buildChatBody,
  extractToolCalls,
  readProviderCtx,
  resolveChatUrlAndHeaders,
  type NeutralChatTool,
} from '@/lib/server/llmProvider'

/**
 * Provider-agnostic structured tool-calling endpoint.
 *
 * The app is BYOK across Claude / OpenAI / OpenRouter / Ollama, so this is a
 * thin translation layer rather than a single-provider Agent SDK: callers pass
 * a neutral (Anthropic-shaped) `tools` array plus `messages`, and the route
 * forwards them in each provider's native tool format and returns the model's
 * tool calls as `{ toolCalls: [{ name, input }] }`. This backs `propose_edit`
 * for multi-region edits — the model emits N structured edits instead of
 * regex-parsed prose.
 *
 * Neutral tool shape (Anthropic-native):
 *   { name: string, description: string, input_schema: JSONSchema }
 */

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const parsed = readProviderCtx(request)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status })
  }
  const { ctx } = parsed

  try {
    const {
      messages,
      tools,
      maxTokens = 2000,
      temperature = 0.2,
    }: {
      messages: { role: string; content: string }[]
      tools: NeutralChatTool[]
      maxTokens?: number
      temperature?: number
    } = await request.json()

    if (!Array.isArray(tools) || tools.length === 0) {
      return NextResponse.json({ error: 'No tools provided' }, { status: 400 })
    }

    const { url, headers, kind } = resolveChatUrlAndHeaders(ctx)
    const body = buildChatBody(ctx, { messages, maxTokens, temperature, tools })

    const response = await fetch(url, {
      method: 'POST',
      headers,
      // A validated public base URL could still 3xx to a private address.
      ...(kind === 'anthropic' ? {} : { redirect: 'manual' as const }),
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const text = await response.text()
      return NextResponse.json({ error: text }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json({ toolCalls: extractToolCalls(kind, data) })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Structured call failed' },
      { status: 500 }
    )
  }
}
