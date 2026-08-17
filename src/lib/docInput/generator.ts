import type { LLMConfig } from '@/lib/ai/client'
import { providerHeaders } from '@/lib/ai/providerHeaders'

export async function generateDocument(
  prompt: string,
  config: LLMConfig,
): Promise<string> {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...providerHeaders(config),
    },
    body: JSON.stringify({ prompt }),
  })

  if (!response.ok) {
    throw new Error(`Generation failed: ${response.statusText}`)
  }

  const data = await response.json()
  return data.content
}
