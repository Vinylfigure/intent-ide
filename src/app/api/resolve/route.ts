import { NextRequest, NextResponse } from 'next/server'
import {
  buildChatBody,
  extractContent,
  parseProviderSseLine,
  readProviderCtx,
  resolveChatUrlAndHeaders,
  type ProviderCtx,
} from '@/lib/server/llmProvider'

// LLM calls (especially MADS rounds) can run long; Vercel default is too short.
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const parsed = readProviderCtx(request)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status })
  }
  const { ctx } = parsed

  try {
    const { messages, maxTokens = 1000, temperature = 0.3, logprobs: requestLogprobs, stream: requestStream } = await request.json()

    // Generate a unique responseId linking input→output for audit traceability
    const responseId = crypto.randomUUID()

    // ---------------------------------------------------------------------------
    // Streaming mode: pipe SSE chunks from the provider to the client
    // ---------------------------------------------------------------------------
    if (requestStream) {
      return handleStreamingRequest({ ctx, messages, maxTokens, temperature, responseId })
    }

    // ---------------------------------------------------------------------------
    // Non-streaming mode (existing behavior)
    // ---------------------------------------------------------------------------
    const { url, headers, kind } = resolveChatUrlAndHeaders(ctx)
    const body = buildChatBody(ctx, {
      messages,
      maxTokens,
      temperature,
      logprobs: requestLogprobs,
    })

    const response = await fetch(url, {
      method: 'POST',
      headers,
      // A validated public base URL could still 3xx to a private address.
      ...(kind === 'openai' ? { redirect: 'manual' as const } : {}),
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const text = await response.text()
      return NextResponse.json({ error: text }, { status: response.status })
    }

    const data = await response.json()
    const { content, logprobs } = extractContent(kind, data)
    return NextResponse.json({ content, logprobs, responseId })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Resolution failed' },
      { status: 500 }
    )
  }
}

// ---------------------------------------------------------------------------
// SSE streaming handler
// ---------------------------------------------------------------------------

interface StreamParams {
  ctx: ProviderCtx
  messages: { role: string; content: string }[]
  maxTokens: number
  temperature: number
  responseId: string
}

function handleStreamingRequest(params: StreamParams): Response {
  const { ctx, messages, maxTokens, temperature, responseId } = params

  const encoder = new TextEncoder()

  const readable = new ReadableStream({
    async start(controller) {
      function sendSSE(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      try {
        // Send responseId immediately
        sendSSE('meta', { responseId })

        const { url, headers, kind } = resolveChatUrlAndHeaders(ctx)
        const body = buildChatBody(ctx, { messages, maxTokens, temperature, stream: true })

        const response = await fetch(url, {
          method: 'POST',
          headers,
          // A validated public base URL could still 3xx to a private address.
          ...(kind === 'openai' ? { redirect: 'manual' as const } : {}),
          body: JSON.stringify(body),
        })

        if (!response.ok || !response.body) {
          const text = await response.text()
          sendSSE('error', { error: text })
          controller.close()
          return
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            const delta = parseProviderSseLine(kind, line)
            if (delta?.text) {
              sendSSE('delta', { text: delta.text })
            }
          }
        }

        // Neither dialect returns logprobs in stream mode
        sendSSE('done', { logprobs: null })
      } catch (err) {
        sendSSE('error', { error: err instanceof Error ? err.message : 'Stream failed' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
