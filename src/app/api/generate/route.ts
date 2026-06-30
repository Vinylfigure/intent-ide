import { NextRequest, NextResponse } from 'next/server'
import { DOC_GENERATION_PROMPT } from '@/lib/ai/prompts'
import { modelRejectsSampling } from '@/lib/ai/modelCapabilities'

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get('x-api-key') || ''
  const provider = request.headers.get('x-provider') || 'claude'
  const model = request.headers.get('x-model') || 'claude-sonnet-4-6'
  const baseUrl = request.headers.get('x-base-url') || ''

  if (provider !== 'ollama' && !apiKey) {
    return NextResponse.json({ error: 'No API key provided' }, { status: 401 })
  }

  try {
    const { prompt } = await request.json()

    if (provider === 'claude') {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4000,
          // Opus 4.7+/Fable 5 reject sampling params with a 400 — omit there.
          ...(modelRejectsSampling(model) ? {} : { temperature: 0.7 }),
          system: DOC_GENERATION_PROMPT,
          messages: [{ role: 'user', content: prompt }],
        }),
      })

      if (!response.ok) {
        const text = await response.text()
        return NextResponse.json({ error: text }, { status: response.status })
      }

      const data = await response.json()
      return NextResponse.json({ content: data.content[0].text })
    } else {
      const url = baseUrl
        ? `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`
        : 'https://api.openai.com/v1/chat/completions'

      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          max_tokens: 4000,
          temperature: 0.7,
          messages: [
            { role: 'system', content: DOC_GENERATION_PROMPT },
            { role: 'user', content: prompt },
          ],
        }),
      })

      if (!response.ok) {
        const text = await response.text()
        return NextResponse.json({ error: text }, { status: response.status })
      }

      const data = await response.json()
      return NextResponse.json({ content: data.choices[0].message.content })
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Generation failed' },
      { status: 500 }
    )
  }
}
