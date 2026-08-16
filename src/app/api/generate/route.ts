import { NextRequest, NextResponse } from 'next/server'
import { DOC_GENERATION_PROMPT } from '@/lib/ai/prompts'
import {
  buildChatBody,
  extractContent,
  readProviderCtx,
  resolveChatUrlAndHeaders,
} from '@/lib/server/llmProvider'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const parsed = readProviderCtx(request)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status })
  }
  const { ctx } = parsed

  try {
    const { prompt } = await request.json()

    const { url, headers, kind } = resolveChatUrlAndHeaders(ctx)
    const body = buildChatBody(ctx, {
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 4000,
      temperature: 0.7,
      system: DOC_GENERATION_PROMPT,
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
    return NextResponse.json({ content: extractContent(kind, data).content })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Generation failed' },
      { status: 500 }
    )
  }
}
