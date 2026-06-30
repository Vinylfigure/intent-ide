import type { LLMConfig } from '@/lib/ai/client'

export async function generateDocument(
  prompt: string,
  config: LLMConfig,
): Promise<string> {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'x-provider': config.provider,
      'x-model': config.model,
      ...(config.baseUrl ? { 'x-base-url': config.baseUrl } : {}),
    },
    body: JSON.stringify({ prompt }),
  })

  if (!response.ok) {
    throw new Error(`Generation failed: ${response.statusText}`)
  }

  const data = await response.json()
  return data.content
}
