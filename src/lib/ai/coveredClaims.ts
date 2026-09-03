import type { ConversationMessage } from '@/lib/annotations/types'

/**
 * What this thread has already said, and whether a new answer just said it
 * again.
 *
 * Passing the raw transcript is not enough. Turn-level repetition is a measured
 * failure distinct from decoding-level degeneration: models reuse the same
 * discourse move at roughly twice the human rate, and the more they repeat the
 * less willing readers are to keep engaging. What moves the needle is an
 * explicit coverage constraint — telling the model what ground is taken, rather
 * than handing it a transcript and hoping it infers novelty.
 *
 * Built locally, at prompt-assembly time. A model-generated ledger would be
 * better prose but would need either a second call on every turn or a new SSE
 * event on the streaming first turn, and neither is worth it to solve "you said
 * the same thing twice".
 */

/** Ledger caps — the envelope competes with the document for context window. */
const MAX_CLAIMS = 8
const MAX_CLAIM_CHARS = 160

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function truncate(text: string): string {
  return text.length <= MAX_CLAIM_CHARS ? text : `${text.slice(0, MAX_CLAIM_CHARS - 1)}…`
}

/**
 * The points this thread has already made, newest last.
 *
 * Takes the leading sentences of each agent turn rather than the whole thing:
 * the opening is where an answer states its claim, and a ledger the size of the
 * conversation would defeat its own purpose.
 */
export function buildCoveredClaims(conversation: ConversationMessage[]): string[] {
  const claims: string[] = []
  for (const message of conversation) {
    if (message.role !== 'agent') continue
    for (const sentence of sentences(message.content).slice(0, 2)) {
      claims.push(truncate(sentence))
    }
  }
  // Keep the most recent, which is what a follow-up is most likely to echo.
  return claims.slice(-MAX_CLAIMS)
}

/** The block of prompt text that states the constraint, or '' when nothing is covered. */
export function formatCoveredClaims(claims: string[]): string {
  if (claims.length === 0) return ''
  return [
    '',
    'ALREADY SAID IN THIS THREAD — do not repeat, restate, or rephrase these as if new:',
    ...claims.map((c) => `  - ${c}`),
    'Add only what is NOT above. If the reader is asking for something already',
    'covered, say so in one sentence and point at which part covered it.',
    'If there is genuinely no new detail, evidence, mechanism or implication left',
    'to add, say that plainly instead of padding — "there is nothing more to add',
    'on this" is a correct and useful answer, and a rephrased repeat is not.',
  ].join('\n')
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'as', 'that', 'this',
  'it', 'its', 'from', 'which', 'not', 'can', 'may', 'will', 'would', 'these',
])

function wordBag(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  )
}

/**
 * Token-set Jaccard overlap between two answers, 0..1.
 *
 * Deliberately crude and local — no embeddings, no network. This is a backstop,
 * not a judgement: the instruction above asks the model not to repeat itself,
 * and verbosity-bias and sycophancy research both say it will sometimes do it
 * anyway. Something has to catch that which does not depend on the model
 * behaving.
 */
export function answerSimilarity(a: string, b: string): number {
  const left = wordBag(a)
  const right = wordBag(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const word of left) if (right.has(word)) shared++
  return shared / (left.size + right.size - shared)
}

/** At or above this, a "new" answer is treated as a repeat. */
export const REPEAT_THRESHOLD = 0.8

export function isRepeatOf(candidate: string, previous: string): boolean {
  return answerSimilarity(candidate, previous) >= REPEAT_THRESHOLD
}
