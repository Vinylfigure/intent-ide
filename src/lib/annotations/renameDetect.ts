/**
 * Detecting that an edit was a RENAME, not a rewrite — and finding where else
 * the old name still stands.
 *
 * Why this is narrow on purpose. An IDE can rename a symbol everywhere because
 * a compiler already resolved the references; the occurrence list is a closed,
 * verifiably correct set. Prose has no such oracle. Coreference resolution runs
 * at roughly F1 78-81% on curated benchmarks and worse on real documents, and
 * its failure cases are exactly the ones that matter here: the same string
 * referring to different people, metonymy, quoted speech, product names that
 * happen to match. So nothing here auto-applies, and the detector fires only on
 * a shape that ordinary rewriting cannot produce.
 *
 * Everything in this module is pure and synchronous. No network — the trigger
 * that calls it guarantees zero egress before the reader consents.
 */

/**
 * Split into alternating word / non-word runs, so two texts that differ by a
 * word-for-word swap stay positionally aligned. Keeping hyphens and apostrophes
 * inside a token means "Anne-Marie" and "O'Neill" survive as single names.
 */
const TOKEN_PATTERN = /[\p{L}\p{N}_'’-]+|[^\p{L}\p{N}_'’-]+/gu

export function tokenize(text: string): string[] {
  return text.match(TOKEN_PATTERN) ?? []
}

const WORD_ONLY = /^[\p{L}\p{N}_'’-]+$/u

/**
 * Words that begin a sentence often enough that a capital tells you nothing.
 * Deliberately short: this is a cheap guard against the most common false
 * positives, not a part-of-speech tagger.
 */
const COMMON_CAPITALISED = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'we', 'i', 'you',
  'they', 'he', 'she', 'there', 'here', 'if', 'when', 'while', 'and', 'but',
  'or', 'so', 'for', 'to', 'in', 'on', 'at', 'by', 'as', 'is', 'are', 'was',
  'were', 'do', 'does', 'did', 'not', 'no', 'yes', 'all', 'some', 'any',
])

/** Does this token look like a proper noun rather than an ordinary word? */
export function looksLikeProperNoun(token: string): boolean {
  if (!WORD_ONLY.test(token)) return false
  if (token.length < 2) return false
  if (COMMON_CAPITALISED.has(token.toLowerCase())) return false
  const first = token[0]
  // An uppercase first letter, and not a SHOUTED word (which is more often an
  // acronym heading or emphasis than a name being renamed).
  if (first !== first.toUpperCase() || first === first.toLowerCase()) return false
  return token !== token.toUpperCase() || token.length <= 5
}

export interface RenameCandidate {
  /** The name as it stood before the edit. */
  from: string
  /** The name the reader typed in its place. */
  to: string
  /** How many times the reader replaced it within this block. */
  replaced: number
}

/**
 * Decide whether `before` → `after` is a single name being renamed.
 *
 * Fires only when every differing token position carries the SAME (from, to)
 * pair. That definition is what makes the two-places-at-once case work: a
 * reader who changed "Cody" to "Joe" twice in one paragraph before the settle
 * fired still produced one rename, not a rewrite. A prefix/suffix character
 * diff would have spanned both edits plus everything between them and rejected
 * exactly the case where the reader has already shown they expect propagation.
 *
 * Returns null for ordinary rewriting, for anything that changes the token
 * count, and for anything where more than one distinct substitution happened.
 */
export function detectRename(before: string, after: string): RenameCandidate | null {
  if (before === after) return null

  const a = tokenize(before)
  const b = tokenize(after)
  // A word-for-word swap preserves the token count. Insertions, deletions and
  // restructuring do not — and none of those are renames.
  if (a.length !== b.length) return null

  let from: string | null = null
  let to: string | null = null
  let replaced = 0

  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue
    if (from === null) {
      from = a[i]
      to = b[i]
    } else if (a[i] !== from || b[i] !== to) {
      // A second, different substitution. That is a rewrite.
      return null
    }
    replaced++
  }

  if (from === null || to === null) return null
  if (!looksLikeProperNoun(from) || !looksLikeProperNoun(to)) return null
  if (from.toLowerCase() === to.toLowerCase()) return null

  return { from, to, replaced }
}

export type ExclusionReason = 'quoted' | 'email' | 'url'

export interface Occurrence {
  /** Character index of the name within the text it was found in. */
  index: number
  /** The sentence around it — what a reader needs to judge it in two seconds. */
  sentence: string
  /** Set when this occurrence is categorically not a narrative reference. */
  excluded?: ExclusionReason
}

const EMAIL_OR_URL = /(?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w-]+\.[\w.-]+/gu

/** Character ranges covered by an email address or a URL. */
function protectedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (const m of text.matchAll(EMAIL_OR_URL)) {
    if (m.index !== undefined) ranges.push([m.index, m.index + m[0].length])
  }
  return ranges
}

/**
 * Character ranges inside quotation marks. Straight and curly pairs both count.
 * Text inside quotes is REPORTED speech — renaming there rewrites somebody's
 * words, which is categorically different from updating the document's own
 * references, so it is never offered rather than merely ranked lower.
 */
function quotedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const pairs: Array<[string, string]> = [['"', '"'], ['“', '”'], ['‘', '’'], ["'", "'"]]
  for (const [open, close] of pairs) {
    let i = 0
    while (i < text.length) {
      const start = text.indexOf(open, i)
      if (start === -1) break
      const end = text.indexOf(close, start + 1)
      if (end === -1) break
      ranges.push([start, end + 1])
      i = end + 1
    }
  }
  return ranges
}

function within(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => index >= start && index < end)
}

/** The sentence containing `index`, trimmed — the context a judgement needs. */
export function sentenceAround(text: string, index: number): string {
  let start = 0
  for (const m of text.slice(0, index).matchAll(/[.!?]\s+/g)) {
    if (m.index !== undefined) start = m.index + m[0].length
  }
  const rest = text.slice(index)
  const endMatch = /[.!?](\s|$)/.exec(rest)
  const end = endMatch ? index + endMatch.index + 1 : text.length
  return text.slice(start, end).trim()
}

/**
 * Every whole-word occurrence of `name` in `text`, each carrying its sentence
 * and, where it applies, the reason it is not a candidate.
 *
 * Exclusions are computed by construction rather than judged, because these are
 * not close calls: a name inside a quotation is reported speech, and a name
 * inside an email address or URL is an identifier, not a reference.
 */
export function findOccurrences(text: string, name: string): Occurrence[] {
  if (!name) return []
  const quoted = quotedRanges(text)
  const identifiers = protectedRanges(text)
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Word boundaries by lookaround, so a name inside "Codyville" never matches.
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'gu')

  const out: Occurrence[] = []
  for (const m of text.matchAll(pattern)) {
    if (m.index === undefined) continue
    const excluded: ExclusionReason | undefined = within(m.index, identifiers)
      ? (/@/.test(text.slice(Math.max(0, m.index - 40), m.index + 40)) ? 'email' : 'url')
      : within(m.index, quoted)
        ? 'quoted'
        : undefined
    out.push({ index: m.index, sentence: sentenceAround(text, m.index), excluded })
  }
  return out
}

/** Occurrences worth putting in front of the reader. */
export function offerableOccurrences(text: string, name: string): Occurrence[] {
  return findOccurrences(text, name).filter((o) => !o.excluded)
}
