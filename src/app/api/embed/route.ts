import { NextRequest, NextResponse } from 'next/server'

/**
 * Provider-agnostic embeddings endpoint backing the doc graph's paraphrase-
 * recall edge source. Same BYOK header convention as /api/structured
 * (x-provider / x-api-key / x-base-url), plus x-embed-model for the embedding
 * model. Anthropic has NO embeddings API: provider 'claude' without a baseUrl
 * override returns 501 {reason:'unsupported'} and the client treats it as a
 * silent no-op — the graph just gets fewer edges.
 *
 * Request:  POST { texts: string[] }
 * Response: { vectors: number[][] } (one vector per input text, same order)
 */

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get('x-api-key') || ''
  const provider = request.headers.get('x-provider') || 'claude'
  const baseUrl = request.headers.get('x-base-url') || ''
  const embedModel = request.headers.get('x-embed-model') || ''

  if (provider === 'claude' && !baseUrl) {
    return NextResponse.json({ reason: 'unsupported' }, { status: 501 })
  }
  if (provider !== 'ollama' && !apiKey) {
    return NextResponse.json({ error: 'No API key provided' }, { status: 401 })
  }

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
