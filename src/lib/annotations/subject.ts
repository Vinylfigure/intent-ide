import type { Annotation } from './types'

/**
 * What an annotation is actually ABOUT — the term under discussion, as opposed
 * to where it is anchored in the document.
 *
 * These are two different questions and the resolver used to conflate them.
 * A sub-annotation inherits its parent's document position on purpose (there is
 * no document position for text that only exists inside an AI answer — see the
 * deliberate split documented in ConversationThread's onDrill handler), but the
 * inherited ANCHOR TEXT is not the child's subject and never was.
 *
 * The old expression, `sourceQuote || anchor.text`, was right for the drill path
 * (which sets `sourceQuote`) and wrong for the "Spin off annotation" path (which
 * does not). A child created that way fell back to the root's anchor text, and
 * so did every descendant of it, forever. Observed at depth 3: the reader asked
 * "is the token in this context a hash value?" and was told
 * `This document does not define "What is tokenization?"` — the root's heading,
 * three levels up, still being treated as the thing under discussion.
 *
 * Resolution order:
 *   1. `sourceQuote` — the reader highlighted a span of a previous answer, and
 *      that span is unambiguously the subject.
 *   2. A child's own `transcript` — what the reader just asked. The inherited
 *      anchor is position, not subject, and must never be used here.
 *   3. A root's `anchor.text` — the reader highlighted the document itself.
 *
 * Callers use this for the "does the document define this?" check and for the
 * prompt's subject line. `anchor.from` remains the retrieval position in both
 * cases; nothing here changes where context is gathered from.
 */
export function annotationSubject(annotation: Annotation): string {
  const quote = annotation.sourceQuote?.trim()
  if (quote) return quote

  if (annotation.parentId) {
    const transcript = annotation.transcript.trim()
    // An empty transcript means the capture produced no text (a voice capture
    // that transcribed to nothing). Falling through to the anchor is the old
    // behaviour and still the least-wrong option when there is no question to
    // read — but it is the exception, not the rule.
    if (transcript) return transcript
  }

  return annotation.anchor.text
}

/** Longest a breadcrumb crumb or a collapsed one-line preview may run. */
const LABEL_CHARS = 40

/**
 * A short human label for an annotation — what a breadcrumb crumb or a
 * collapsed deep-thread preview shows.
 *
 * Nothing derived one before, because depth was communicated purely by
 * indentation and a card was never reduced to a single line. Prefers the
 * reader's own words (the transcript) over the quote, because in a breadcrumb
 * "is the token a hash value?" locates you in the thread and the quoted span
 * does not.
 */
export function annotationLabel(annotation: Annotation): string {
  const raw =
    annotation.transcript.trim() ||
    annotation.sourceQuote?.trim() ||
    annotation.anchor.text.trim()
  const clean = raw.replace(/\s+/g, ' ')
  return clean.length <= LABEL_CHARS ? clean : `${clean.slice(0, LABEL_CHARS - 1)}…`
}
