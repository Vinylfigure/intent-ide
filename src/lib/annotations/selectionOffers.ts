import type { AnnotationType, Scope } from './types'

/** Intent an offer can carry — 'flag' has no self-serve prompt, so it is excluded (matches AnnotationComposer's QUICK_ACTIONS). */
export type OfferIntent = Exclude<AnnotationType, 'flag'>

export interface Offer {
  label: string
  intent: OfferIntent
  prompt: string
}

/** Cap on interpolated selection text in a generated prompt — a paragraph-sized
 *  selection shouldn't blow the prompt up into something the model has to re-read. */
const MAX_PROMPT_TEXT = 120

/** Cap on offers returned by deriveOffers — more than this and the composer's row stops reading as a menu. */
const MAX_OFFERS = 4

function truncate(text: string, max: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max).trimEnd()}…`
}

/**
 * Matches a number-shaped claim worth interrogating: percentages, currency,
 * durations/counts with units, ISO dates, and small spelled-out numbers
 * followed by a unit word (the "thirty days" case a bare digit regex misses).
 * Deliberately loose — false positives just add an extra offer, false
 * negatives silently drop one, and the former is the cheaper mistake.
 */
const FIGURE_PATTERN =
  /(\$\s?\d[\d,]*(\.\d+)?)|(\d[\d,]*(\.\d+)?\s?%)|(\d{4}-\d{2}-\d{2})|(\b\d[\d,]*(\.\d+)?\s?(days?|weeks?|months?|years?|hours?|minutes?|seconds?)\b)|(\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b[\w\s-]{0,20}\b(days?|weeks?|months?|years?|hours?|minutes?|percent|dollars?)\b)/i

/** Same "Diagram this" prompt as AnnotationComposer's QUICK_ACTIONS, verbatim
 *  (the mermaid formatting instructions are load-bearing), just with the
 *  selected text spliced in so the diagram has something concrete to draw. */
function diagramPrompt(text: string): string {
  return `Diagram the structure or flow described in "${text}". Respond with a single \`\`\`mermaid fenced code block (flowchart or sequence diagram), followed by at most one sentence of caption.`
}

/**
 * Infers a Scope from text alone — no EditorState, no document structure.
 * Extracted from `inferScope` (src/lib/prosemirror/helpers.ts) so the same
 * sentence-count/length heuristic can classify a selection made inside a
 * rendered AI answer, where there is no ProseMirror doc to resolve positions
 * against. Never returns 'section': that classification depends on heading
 * detection and paragraph boundaries `inferScope`'s structural branches see
 * and this function cannot.
 */
export function inferScopeFromText(text: string): Scope {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 'phrase'

  const sentences = trimmed.split(/[.!?]+/).filter((s) => s.trim().length > 0)
  if (sentences.length <= 1 && trimmed.length < 100) return 'phrase'
  if (sentences.length === 1) return 'sentence'
  return 'paragraph'
}

/** Extra signal deriveOffers can use beyond the anchor's own text/scope — both optional, both additive. */
export interface OfferContext {
  /** True when the document declares an invariant the selection could be checked against. */
  hasInvariant?: boolean
  /** Count of related passages found elsewhere in the doc, if a search already ran. */
  relatedCount?: number
}

/**
 * Turns a selection anchor into the ranked one-click offers a composer shows
 * beside it. Context-derived offers (invariant check, related passages) sort
 * first because they're specific to THIS document, not to the selection's
 * shape; shape-based offers (figure, heading, phrase/sentence/paragraph) fill
 * the rest. Figure detection runs before scope-based rules because a
 * phrase-scoped "30 days" is more useful offered "Why this figure?" than
 * "Define" — shape beats size once both apply.
 */
export function deriveOffers(
  anchor: { text: string; scope: Scope; nodeType?: string },
  ctx?: OfferContext,
): Offer[] {
  const text = truncate(anchor.text, MAX_PROMPT_TEXT)
  const offers: Offer[] = []

  if (ctx?.hasInvariant) {
    offers.push({
      label: 'Check against what you declared',
      intent: 'ask',
      prompt: `Check "${text}" against what was declared earlier in this document. Does it still hold?`,
    })
  }

  if (typeof ctx?.relatedCount === 'number' && ctx.relatedCount > 0) {
    offers.push({
      label: `${ctx.relatedCount} related passage${ctx.relatedCount === 1 ? '' : 's'}`,
      intent: 'dig',
      prompt: `Find and summarize the ${ctx.relatedCount} passages elsewhere in this document related to "${text}".`,
    })
  }

  if (FIGURE_PATTERN.test(anchor.text)) {
    offers.push(
      { label: 'Why this figure?', intent: 'ask', prompt: `Explain where "${text}" comes from and why it's this value.` },
      { label: 'Change it', intent: 'edit', prompt: `Change "${text}" and update anything else that depends on it.` },
      { label: 'Check consistency', intent: 'dig', prompt: `Check "${text}" for consistency against the rest of this document.` },
    )
  } else if (anchor.nodeType === 'heading' || anchor.scope === 'section') {
    offers.push(
      { label: 'Outline this', intent: 'dig', prompt: `Outline the section under "${text}".` },
      { label: 'What belongs here?', intent: 'ask', prompt: `What content belongs under "${text}"?` },
    )
  } else if (anchor.scope === 'phrase') {
    offers.push(
      { label: 'Define', intent: 'ask', prompt: `Define "${text}" as used here.` },
      { label: 'Why this word?', intent: 'ask', prompt: `Explain why "${text}" is the right word choice here.` },
      { label: 'Change it', intent: 'edit', prompt: `Suggest a better replacement for "${text}".` },
    )
  } else if (anchor.scope === 'sentence') {
    offers.push(
      { label: 'Explain', intent: 'ask', prompt: `Explain "${text}" in plain language.` },
      { label: 'Justify this', intent: 'ask', prompt: `Justify the claim made in "${text}".` },
      { label: 'Rewrite', intent: 'edit', prompt: `Rewrite "${text}" to be clearer.` },
    )
  } else if (anchor.scope === 'paragraph') {
    offers.push(
      { label: 'Summarize', intent: 'ask', prompt: `Summarize "${text}" in one or two sentences.` },
      { label: 'Diagram this', intent: 'dig', prompt: diagramPrompt(text) },
      { label: 'Find conflicts', intent: 'dig', prompt: `Find anything elsewhere in this document that conflicts with "${text}".` },
    )
  }

  return offers.slice(0, MAX_OFFERS)
}

/** Fallback offers for when there is no anchor to derive from — identical to AnnotationComposer's QUICK_ACTIONS. */
export const DEFAULT_OFFERS: Offer[] = [
  {
    label: 'Explain this',
    intent: 'ask',
    prompt: 'Explain this passage in plain language.',
  },
  {
    label: 'Give an example',
    intent: 'dig',
    prompt: 'Give one concrete example that illustrates this passage.',
  },
  {
    label: 'Diagram this',
    intent: 'dig',
    prompt:
      'Diagram the structure or flow described in this passage. Respond with a single ```mermaid fenced code block (flowchart or sequence diagram), followed by at most one sentence of caption.',
  },
]
