import { NextRequest, NextResponse } from 'next/server'
import { CLASSIFICATION_PROMPT } from '@/lib/ai/prompts'
import {
  buildChatBody,
  extractContent,
  readProviderCtx,
  resolveChatUrlAndHeaders,
} from '@/lib/server/llmProvider'

const VALID_TYPES = ['ask', 'edit', 'dig', 'flag']

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const parsed = readProviderCtx(request)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status })
  }
  const { ctx } = parsed

  try {
    const { transcript, anchoredText, suggestedType } = await request.json()

    const prompt = `${CLASSIFICATION_PROMPT
      .replace('{{transcript}}', transcript)
      .replace('{{anchoredText}}', anchoredText)}${
      suggestedType ? `\n\nSuggested intent hint: ${String(suggestedType).toUpperCase()}. Use it only if the user input supports it.` : ''
    }`

    const { url, headers, kind } = resolveChatUrlAndHeaders(ctx)
    const body = buildChatBody(ctx, {
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 50,
      temperature: 0,
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
    const type = extractContent(kind, data).content.trim().toLowerCase()

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
