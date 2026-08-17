import { NextRequest, NextResponse } from 'next/server'
import { normalizeServerProvider, readProviderCtx } from '@/lib/server/llmProvider'

/**
 * Provider-agnostic embeddings endpoint backing the doc graph's paraphrase-
 * recall edge source. Same BYOK header convention as /api/structured
 * (x-provider / x-api-key / x-base-url), plus x-embed-model for the embedding
 * model. Anthropic has NO embeddings API: provider 'claude' without a baseUrl
 * override returns 501 {reason:'unsupported'} and the client treats it as a
 * silent no-op — the graph just gets fewer edges. OpenRouter does not proxy an
 * embeddings API either, so it returns the same 501.
 *
 * Request:  POST { texts: string[] }
 * Response: { vectors: number[][] } (one vector per input text, same order)
 */

export async function POST(request: NextRequest) {
  // Embeddings-support gates run BEFORE the generic guards so the client's
  // silent no-op contract (501 {reason:'unsupported'}) holds even when no API
  // key is configured.
  const rawProvider = normalizeServerProvider(request.headers.get('x-provider') || 'claude')
  const rawBaseUrl = request.headers.get('x-base-url') || ''

  if (rawProvider === 'claude' && !rawBaseUrl) {
    return NextResponse.json({ reason: 'unsupported' }, { status: 501 })
  }
  if (rawProvider === 'openrouter') {
    return NextResponse.json({ reason: 'unsupported' }, { status: 501 })
  }

  const parsed = readProviderCtx(request)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status })
  }
  const { provider, apiKey, baseUrl } = parsed.ctx
  const embedModel = request.headers.get('x-embed-model') || ''

  try {
    const { texts }: { texts: string[] } = await request.json()
    if (!Array.isArray(texts) || texts.length === 0 || texts.some((t) => typeof t !== 'string')) {
      return NextResponse.json(
        { error: 'texts must be a non-empty array of strings' },
        { status: 400 }
      )
    }

    if (provider === 'ollama') {
      // Ollama-native /api/embed: { model, input } → { embeddings }.
      const url = `${(baseUrl || 'http://localhost:11434').replace(/\/$/, '')}/api/embed`
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: embedModel || 'nomic-embed-text', input: texts }),
      })

      if (!response.ok) {
        const text = await response.text()
        return NextResponse.json({ error: text }, { status: response.status })
      }

      const data = await response.json()
      const vectors: number[][] = Array.isArray(data.embeddings) ? data.embeddings : []
      return NextResponse.json({ vectors })
    }

    // OpenAI-compatible /v1/embeddings (OpenAI, or any base-URL override —
    // including 'claude' pointed at a proxy that does serve embeddings).
    const url = baseUrl
      ? `${baseUrl.replace(/\/$/, '')}/v1/embeddings`
      : 'https://api.openai.com/v1/embeddings'

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: embedModel || 'text-embedding-3-small', input: texts }),
    })

    if (!response.ok) {
      const text = await response.text()
      return NextResponse.json({ error: text }, { status: response.status })
    }

    const data = await response.json()
    const vectors: number[][] = (data.data || []).map(
      (d: { embedding: number[] }) => d.embedding
    )
    return NextResponse.json({ vectors })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Embedding call failed' },
      { status: 500 }
    )
  }
}
