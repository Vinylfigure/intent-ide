import { NextRequest, NextResponse } from 'next/server'
import { CLASSIFICATION_PROMPT } from '@/lib/ai/prompts'
import { modelRejectsSampling } from '@/lib/ai/modelCapabilities'

const VALID_TYPES = ['ask', 'edit', 'dig', 'flag']

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get('x-api-key') || ''
  const provider = request.headers.get('x-provider') || 'claude'
  const model = request.headers.get('x-model') || 'claude-sonnet-4-6'
  const baseUrl = request.headers.get('x-base-url') || ''

  // Only require API key for non-Ollama providers
  if (provider !== 'ollama' && !apiKey) {
    return NextResponse.json({ error: 'No API key provided' }, { status: 401 })
  }

  try {
    const { transcript, anchoredText, suggestedType } = await request.json()

    const prompt = `${CLASSIFICATION_PROMPT
      .replace('{{transcript}}', transcript)
      .replace('{{anchoredText}}', anchoredText)}${
      suggestedType ? `\n\nSuggested intent hint: ${String(suggestedType).toUpperCase()}. Use it only if the user input supports it.` : ''
    }`

    let type: string

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
          max_tokens: 50,
          // Opus 4.7+/Fable 5 reject sampling params with a 400 — omit there.
          ...(modelRejectsSampling(model) ? {} : { temperature: 0 }),
          messages: [{ role: 'user', content: prompt }],
        }),
      })

      if (!response.ok) {
        const text = await response.text()
        return NextResponse.json({ error: text }, { status: response.status })
      }

      const data = await response.json()
      type = data.content[0].text.trim().toLowerCase()
    } else {
      // OpenAI-compatible (OpenAI or Ollama)
      const url = baseUrl
        ? `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`
        : 'https://api.openai.com/v1/chat/completions'

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          max_tokens: 50,
          temperature: 0,
          messages: [{ role: 'user', content: prompt }],
        }),
      })

      if (!response.ok) {
        const text = await response.text()
        return NextResponse.json({ error: text }, { status: response.status })
      }

      const data = await response.json()
      type = data.choices[0].message.content.trim().toLowerCase()
    }

    // Extract just the type word (model might add punctuation)
    const matched = VALID_TYPES.find((t) => type.includes(t))
    return NextResponse.json({ type: matched || 'flag' })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Classification failed' },
      { status: 500 }
    )
  }
}
