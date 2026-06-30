import type { LLMConfig } from './client'
import type { AnnotationType } from '@/lib/annotations/types'

const VALID_TYPES: AnnotationType[] = ['ask', 'edit', 'dig', 'flag']

const CLASSIFICATION_PROMPT_4TYPE = `You are an annotation classifier for a document review tool. Given the user's input and the text they selected, classify their intent into exactly one of these types:

- ASK: Seeking clarification ("What does this mean?", "Is this right?", "Why is this here?")
- EDIT: Directing a change ("Change this to X", "Make it shorter", "Fix this", "Restructure", "This is wrong, it should be Y")
- DIG: Investigating deeper ("Tell me more", "What are the implications?", "Research this", "What evidence supports this?")
- FLAG: Marking something problematic ("This seems off", "Something's wrong here", "Come back to this", "Not sure about this")

Respond with ONLY the type name in uppercase: ASK, EDIT, DIG, or FLAG.

User said: "{{transcript}}"
Selected text: "{{anchoredText}}"

Type:`

export async function classifyAnnotation(
  transcript: string,
  anchoredText: string,
  config: LLMConfig,
  suggestedType?: AnnotationType | null,
): Promise<AnnotationType> {
  const prompt = CLASSIFICATION_PROMPT_4TYPE
    .replace('{{transcript}}', transcript)
    .replace('{{anchoredText}}', anchoredText)

  try {
    const response = await fetch('/api/classify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'x-provider': config.provider,
        'x-model': config.model,
        ...(config.baseUrl ? { 'x-base-url': config.baseUrl } : {}),
      },
      body: JSON.stringify({ transcript, anchoredText, suggestedType: suggestedType ?? null }),
    })

    if (!response.ok) {
      console.error('Classification failed, defaulting to flag')
      return suggestedType ?? 'flag'
    }

    const data = await response.json()
    const type = data.type?.trim().toLowerCase() as AnnotationType

    if (VALID_TYPES.includes(type)) {
      return type
    }

    return suggestedType ?? 'flag'
  } catch (err) {
    console.error('Classification error:', err)
    return suggestedType ?? 'flag'
  }
}
