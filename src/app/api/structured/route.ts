import { NextRequest, NextResponse } from 'next/server'
import { modelRejectsSampling } from '@/lib/ai/modelCapabilities'

/**
 * Provider-agnostic structured tool-calling endpoint.
 *
 * The app is BYOK across Claude / OpenAI / Ollama, so this is a thin translation
 * layer rather than a single-provider Agent SDK: callers pass a neutral
 * (Anthropic-shaped) `tools` array plus `messages`, and the route forwards them
 * in each provider's native tool format and returns the model's tool calls as
 * `{ toolCalls: [{ name, input }] }`. This backs `propose_edit` for multi-region
 * edits — the model emits N structured edits instead of regex-parsed prose.
 *
 * Neutral tool shape (Anthropic-native):
 *   { name: string, description: string, input_schema: JSONSchema }
 */

interface NeutralTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

interface ToolCall {
  name: string
  input: unknown
}

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get('x-api-key') || ''
  const provider = request.headers.get('x-provider') || 'claude'
  const model = request.headers.get('x-model') || 'claude-sonnet-4-6'
  const baseUrl = request.headers.get('x-base-url') || ''

  if (provider !== 'ollama' && !apiKey) {
    return NextResponse.json({ error: 'No API key provided' }, { status: 401 })
  }

  try {
    const {
      messages,
      tools,
      maxTokens = 2000,
      temperature = 0.2,
    }: {
      messages: { role: string; content: string }[]
      tools: NeutralTool[]
      maxTokens?: number
      temperature?: number
    } = await request.json()

    if (!Array.isArray(tools) || tools.length === 0) {
      return NextResponse.json({ error: 'No tools provided' }, { status: 400 })
    }

    if (provider === 'claude') {
      const systemMessage = messages.find((m) => m.role === 'system')?.content || ''
      const userMessages = messages.filter((m) => m.role !== 'system')

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          ...(modelRejectsSampling(model) ? {} : { temperature }),
          system: systemMessage,
          messages: userMessages,
          tools,
          // Encourage but don't force — the model may legitimately propose zero edits.
          tool_choice: { type: 'auto' },
        }),
      })

      if (!response.ok) {
        const text = await response.text()
        return NextResponse.json({ error: text }, { status: response.status })
      }

      const data = await response.json()
      const toolCalls: ToolCall[] = (data.content || [])
        .filter((b: { type: string }) => b.type === 'tool_use')
        .map((b: { name: string; input: unknown }) => ({ name: b.name, input: b.input }))

      return NextResponse.json({ toolCalls })
    }

    // OpenAI-compatible (OpenAI or Ollama). Both accept the `tools` function shape;
    // Ollama tool support varies by model, so we tolerate an empty tool_calls array.
    const url = baseUrl
      ? `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`
      : 'https://api.openai.com/v1/chat/completions'

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

    const openaiTools = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }))

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        messages,
        tools: openaiTools,
        tool_choice: 'auto',
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      return NextResponse.json({ error: text }, { status: response.status })
    }

    const data = await response.json()
    const rawCalls = data.choices?.[0]?.message?.tool_calls || []
    const toolCalls: ToolCall[] = rawCalls.map(
      (c: { function: { name: string; arguments: string } }) => {
        let input: unknown = {}
        try {
          input = JSON.parse(c.function.arguments)
        } catch {
          input = {}
        }
        return { name: c.function.name, input }
      }
    )

    return NextResponse.json({ toolCalls })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Structured call failed' },
      { status: 500 }
    )
  }
}
