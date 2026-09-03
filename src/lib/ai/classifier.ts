import type { LLMConfig } from './client'
import { providerHeaders } from './providerHeaders'
import { parseClassification, type Classification } from './classification'
import type { AnnotationType } from '@/lib/annotations/types'

/**
 * Classify an annotation: what the reader wants done, and whether the
 * highlighted span is the subject of what they said or only where the thought
 * struck them.
 *
 * Both judgements come out of ONE round-trip — the one that already existed.
 * `/api/classify` has always received the transcript and the anchored text
 * together, so the relation costs no extra call and adds no second point of
 * failure.
 *
 * This file previously carried its own copy of the classification prompt,
 * built into a local `prompt` variable that was never sent anywhere: the
 * request body has always been `{transcript, anchoredText, suggestedType}` and
 * the route builds the prompt itself. That dead copy is gone, so there is now
 * exactly one classification prompt, in prompts.ts.
 */
export async function classifyAnnotation(
  transcript: string,
  anchoredText: string,
  config: LLMConfig,
  suggestedType?: AnnotationType | null,
): Promise<Classification> {
  const fallback: Classification = { type: suggestedType ?? 'flag', relation: 'about' }

  try {
    const response = await fetch('/api/classify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...providerHeaders(config),
      },
      body: JSON.stringify({ transcript, anchoredText, suggestedType: suggestedType ?? null }),
    })

    if (!response.ok) {
      console.error('Classification failed, defaulting to flag')
      return fallback
    }

    const data = await response.json()
    // The route parses already; re-reading its answer through the same parser
    // keeps this correct if a provider or an older route ever hands back a
    // bare word instead of the pair.
    return parseClassification(JSON.stringify(data ?? {}), suggestedType ?? null)
  } catch (err) {
    console.error('Classification error:', err)
    return fallback
  }
}

export type { Classification, AnnotationType }
