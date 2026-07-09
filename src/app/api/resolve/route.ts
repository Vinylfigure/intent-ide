import { NextRequest, NextResponse } from 'next/server'
import { modelRejectsSampling } from '@/lib/ai/modelCapabilities'
import { validateBaseUrl } from '@/lib/server/validateBaseUrl'

// LLM calls (especially MADS rounds) can run long; Vercel default is too short.
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get('x-api-key') || ''
  const provider = request.headers.get('x-provider') || 'claude'
  const model = request.headers.get('x-model') || 'claude-sonnet-4-6'
  const baseUrl = request.headers.get('x-base-url') || ''

  if (provider !== 'ollama' && !apiKey) {
    return NextResponse.json({ error: 'No API key provided' }, { status: 401 })
  }

  const baseUrlError = validateBaseUrl(baseUrl)
  if (baseUrlError) {
    return NextResponse.json({ error: baseUrlError }, { status: 400 })
  }

  try {
    const { messages, maxTokens = 1000, temperature = 0.3, logprobs: requestLogprobs, stream: requestStream } = await request.json()

    // Generate a unique responseId linking input→output for audit traceability
    const responseId = crypto.randomUUID()

    // ---------------------------------------------------------------------------
    // Streaming mode: pipe SSE chunks from the provider to the client
    // ---------------------------------------------------------------------------
    if (requestStream) {
      return handleStreamingRequest({
        provider, apiKey, model, baseUrl, messages, maxTokens, temperature, responseId,
      })
    }

    // ---------------------------------------------------------------------------
    // Non-streaming mode (existing behavior)
    // ---------------------------------------------------------------------------
    if (provider === 'claude') {
      const systemMessage = messages.find((m: any) => m.role === 'system')?.content || ''
      const userMessages = messages.filter((m: any) => m.role !== 'system')

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
          // Opus 4.7+/Fable 5 reject sampling params with a 400 — omit there.
          ...(modelRejectsSampling(model) ? {} : { temperature }),
          system: systemMessage,
          messages: userMessages,
        }),
      })

      if (!response.ok) {
        const text = await response.text()
        return NextResponse.json({ error: text }, { status: response.status })
      }

      const data = await response.json()
      // Claude does not support logprobs — return null
      return NextResponse.json({ content: data.content[0].text, logprobs: null, responseId })
    } else {
      // OpenAI-compatible (OpenAI or Ollama)
      const url = baseUrl
        ? `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`
        : 'https://api.openai.com/v1/chat/completions'

      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

      const body: Record<string, unknown> = { model, max_tokens: maxTokens, temperature, messages }

      // Request logprobs if the caller asked for them (OpenAI supports this)
      if (requestLogprobs) {
        body.logprobs = true
        body.top_logprobs = 5 // Top-5 tokens for entropy calculation
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        // A validated public base URL could still 3xx to a private address.
        redirect: 'manual',
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const text = await response.text()
        return NextResponse.json({ error: text }, { status: response.status })
      }

      const data = await response.json()
      const choice = data.choices[0]
      return NextResponse.json({
        content: choice.message.content,
        logprobs: choice.logprobs ?? null,
        responseId,
      })
    }
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
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  messages: any[]
  maxTokens: number
  temperature: number
  responseId: string
}

function handleStreamingRequest(params: StreamParams): Response {
  const { provider, apiKey, model, baseUrl, messages, maxTokens, temperature, responseId } = params

  const encoder = new TextEncoder()

  const readable = new ReadableStream({
    async start(controller) {
      function sendSSE(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      try {
        // Send responseId immediately
        sendSSE('meta', { responseId })

        if (provider === 'claude') {
          const systemMessage = messages.find((m: any) => m.role === 'system')?.content || ''
          const userMessages = messages.filter((m: any) => m.role !== 'system')

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
              // Opus 4.7+/Fable 5 reject sampling params with a 400 — omit there.
              ...(modelRejectsSampling(model) ? {} : { temperature }),
              system: systemMessage,
              messages: userMessages,
              stream: true,
            }),
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
              if (!line.startsWith('data: ')) continue
              const payload = line.slice(6).trim()
              if (payload === '[DONE]') continue

              try {
                const event = JSON.parse(payload)
                if (event.type === 'content_block_delta' && event.delta?.text) {
                  sendSSE('delta', { text: event.delta.text })
                }
              } catch {
                // Ignore malformed JSON lines
              }
            }
          }

          sendSSE('done', { logprobs: null })
        } else {
          // OpenAI-compatible streaming
          const url = baseUrl
            ? `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`
            : 'https://api.openai.com/v1/chat/completions'

          const headers: Record<string, string> = { 'Content-Type': 'application/json' }
          if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

          const response = await fetch(url, {
            method: 'POST',
            headers,
            redirect: 'manual',
            body: JSON.stringify({
              model,
              max_tokens: maxTokens,
              temperature,
              messages,
              stream: true,
            }),
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
              if (!line.startsWith('data: ')) continue
              const payload = line.slice(6).trim()
              if (payload === '[DONE]') continue

              try {
                const chunk = JSON.parse(payload)
                const delta = chunk.choices?.[0]?.delta?.content
                if (delta) {
                  sendSSE('delta', { text: delta })
                }
              } catch {
                // Ignore malformed JSON lines
              }
            }
          }

          // OpenAI streaming doesn't return logprobs in stream mode
          sendSSE('done', { logprobs: null })
        }
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
