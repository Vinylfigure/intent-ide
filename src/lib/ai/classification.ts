import type { AnchorRelation, AnnotationType } from '@/lib/annotations/types'

export const VALID_TYPES: AnnotationType[] = ['ask', 'edit', 'dig', 'flag']
const VALID_RELATIONS: AnchorRelation[] = ['about', 'sparked_by']

export interface Classification {
  type: AnnotationType
  relation: AnchorRelation
}

/**
 * Parse the classifier's reply into a type and an anchor relation.
 *
 * The prompt asks for strict JSON, but this runs against whatever provider the
 * reader configured — including small local models that will happily answer
 * "DIG" to a request for an object, or wrap the object in a code fence. So the
 * parse degrades in a specific direction:
 *
 *   1. a real JSON object with valid fields wins;
 *   2. failing that, the old substring match recovers the type, exactly as
 *      before this second axis existed;
 *   3. relation falls back to 'about', which is both the common case and the
 *      pre-existing behaviour.
 *
 * Degrading relation to 'about' rather than guessing is the point: a wrong
 * 'sparked_by' silently suppresses the undefined-term guard, whereas a wrong
 * 'about' merely reproduces what the tool did before, and the reader has a
 * one-click correction either way.
 */
export function parseClassification(
  raw: string,
  suggestedType?: AnnotationType | null,
): Classification {
  const fallbackType = (): AnnotationType => {
    const lower = raw.toLowerCase()
    return VALID_TYPES.find((t) => lower.includes(t)) ?? suggestedType ?? 'flag'
  }

  // Take the outermost brace pair, so a code fence or a stray "Here you go:"
  // preamble doesn't defeat the parse.
  const open = raw.indexOf('{')
  const close = raw.lastIndexOf('}')
  if (open !== -1 && close > open) {
    try {
      const parsed = JSON.parse(raw.slice(open, close + 1)) as Record<string, unknown>
      const type = String(parsed.type ?? '').trim().toLowerCase() as AnnotationType
      const relation = String(parsed.relation ?? '').trim().toLowerCase() as AnchorRelation
      return {
        type: VALID_TYPES.includes(type) ? type : fallbackType(),
        relation: VALID_RELATIONS.includes(relation) ? relation : 'about',
      }
    } catch {
      // Malformed JSON — fall through to the substring path below.
    }
  }

  return { type: fallbackType(), relation: 'about' }
}
