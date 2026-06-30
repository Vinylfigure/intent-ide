/**
 * Token-Level Uncertainty Calculation.
 *
 * Extracts logprobs from LLM responses and computes per-token entropy
 * using the formula: Uncertainty = -Σ (p * log(p)) across top-k tokens.
 *
 * Maps high-entropy tokens to uncertaintyStore for UI highlighting.
 *
 * Note: Claude does not support logprobs. This works with OpenAI-compatible
 * providers. When logprobs are unavailable, uncertainty is not computed
 * (graceful degradation — no fake confidence scores).
 */

import { EditorView } from 'prosemirror-view'
import { useUncertaintyStore, type UncertainToken, type TokenAlternative } from '@/stores/uncertaintyStore'
import { addUncertaintyDecorations } from '@/lib/prosemirror/plugins/uncertaintyPlugin'
import { generateId } from '@/lib/utils/id'

// ---------------------------------------------------------------------------
// Types (matches OpenAI logprobs response shape)
// ---------------------------------------------------------------------------

export interface TokenLogprob {
  token: string
  logprob: number
  top_logprobs: Array<{ token: string; logprob: number }>
}

export interface LogprobsResult {
  content: Array<TokenLogprob>
}

// ---------------------------------------------------------------------------
// Entropy Calculation
// ---------------------------------------------------------------------------

/**
 * Compute Shannon entropy for a single token from its top-k logprobs.
 *
 * Formula: H = -Σ (p * log(p))
 *
 * Returns a value in [0, max_entropy]. Higher = more uncertain.
 * Normalized to [0, 1] by dividing by log(k) where k = number of top tokens.
 */
export function computeTokenEntropy(topLogprobs: Array<{ logprob: number }>): number {
  if (topLogprobs.length === 0) return 0

  // Convert logprobs to probabilities
  const probs = topLogprobs.map((t) => Math.exp(t.logprob))

  // Normalize probabilities (they should already sum to ~1 for top-k, but ensure it)
  const sum = probs.reduce((a, b) => a + b, 0)
  const normalized = probs.map((p) => p / sum)

  // Shannon entropy: H = -Σ (p * log(p))
  let entropy = 0
  for (const p of normalized) {
    if (p > 0) {
      entropy -= p * Math.log(p)
    }
  }

  // Normalize to [0, 1] by dividing by max possible entropy (uniform distribution)
  const maxEntropy = Math.log(topLogprobs.length)
  if (maxEntropy === 0) return 0

  return Math.min(entropy / maxEntropy, 1)
}

// ---------------------------------------------------------------------------
// Uncertainty Map Builder
// ---------------------------------------------------------------------------

export interface UncertaintyMapEntry {
  token: string
  entropy: number // 0–1 normalized
  position: number // character offset in the generated text
  alternatives: TokenAlternative[] // top alternative tokens (excluding the chosen one)
}

/**
 * Build an uncertainty map from logprobs data.
 * Returns entries sorted by entropy (highest first).
 */
export function buildUncertaintyMap(
  logprobs: LogprobsResult,
  entropyThreshold: number = 0.3,
): UncertaintyMapEntry[] {
  const entries: UncertaintyMapEntry[] = []
  let charOffset = 0

  for (const tokenData of logprobs.content) {
    const entropy = computeTokenEntropy(
      tokenData.top_logprobs.length > 0
        ? tokenData.top_logprobs
        : [{ logprob: tokenData.logprob }]
    )

    if (entropy >= entropyThreshold) {
      // Extract top alternatives (exclude the chosen token itself)
      const alternatives: TokenAlternative[] = tokenData.top_logprobs
        .filter((t) => t.token !== tokenData.token)
        .map((t) => ({ token: t.token, probability: Math.exp(t.logprob) }))
        .sort((a, b) => b.probability - a.probability)
        .slice(0, 3)

      entries.push({
        token: tokenData.token,
        entropy,
        position: charOffset,
        alternatives,
      })
    }

    charOffset += tokenData.token.length
  }

  return entries.sort((a, b) => b.entropy - a.entropy)
}

// ---------------------------------------------------------------------------
// ProseMirror Integration
// ---------------------------------------------------------------------------

/**
 * Find the position of a generated token in the ProseMirror document.
 * The generatedText should be the full LLM response, and we search for
 * the token at the expected character offset within a target region.
 */
function findTokenInDoc(
  view: EditorView,
  token: string,
  searchFrom: number,
  searchTo: number,
): { from: number; to: number } | null {
  const doc = view.state.doc
  const docText = doc.textBetween(searchFrom, searchTo)
  const idx = docText.indexOf(token)
  if (idx === -1) return null

  return {
    from: searchFrom + idx,
    to: searchFrom + idx + token.length,
  }
}

/**
 * Apply uncertainty highlights to a region of the document
 * based on logprobs from an LLM response.
 *
 * @param view - ProseMirror EditorView
 * @param logprobs - Logprobs data from LLM response
 * @param regionFrom - Start of the document region that was generated/edited
 * @param regionTo - End of the document region
 * @param entropyThreshold - Minimum entropy to highlight (default 0.3)
 */
export function applyUncertaintyFromLogprobs(
  view: EditorView,
  logprobs: LogprobsResult,
  regionFrom: number,
  regionTo: number,
  entropyThreshold: number = 0.3,
): number {
  const uncertaintyMap = buildUncertaintyMap(logprobs, entropyThreshold)

  if (uncertaintyMap.length === 0) return 0

  const tokens: UncertainToken[] = []

  for (const entry of uncertaintyMap) {
    const pos = findTokenInDoc(view, entry.token, regionFrom, regionTo)
    if (!pos) continue

    tokens.push({
      id: generateId(),
      from: pos.from,
      to: pos.to,
      editProbability: entry.entropy, // Maps to HSL gradient in uncertaintyPlugin
      originalToken: entry.token,
      alternatives: entry.alternatives,
    })
  }

  if (tokens.length > 0) {
    // Add to store
    useUncertaintyStore.getState().addTokens(tokens)

    // Add decorations
    addUncertaintyDecorations(view, tokens)
  }

  return tokens.length
}

/**
 * Extract uncertainty flags from MADS debate output and apply
 * as uncertainty decorations in the document.
 *
 * This is used when logprobs aren't available (e.g., Claude) but
 * the MADS Judge identifies uncertain claims.
 */
export function applyUncertaintyFromFlags(
  view: EditorView,
  flags: string[],
  regionFrom: number,
  regionTo: number,
): number {
  if (flags.length === 0) return 0

  const tokens: UncertainToken[] = []

  for (const flag of flags) {
    // Extract the uncertain phrase from the flag text
    // Flags typically look like: "the claim about X — uncertain because..."
    const phrase = extractPhraseFromFlag(flag)
    if (!phrase) continue

    const pos = findTokenInDoc(view, phrase, regionFrom, regionTo)
    if (!pos) continue

    tokens.push({
      id: generateId(),
      from: pos.from,
      to: pos.to,
      editProbability: 0.7, // High uncertainty for flagged claims
      originalToken: phrase,
      alternatives: [], // No alternatives available from MADS flags
    })
  }

  if (tokens.length > 0) {
    useUncertaintyStore.getState().addTokens(tokens)
    addUncertaintyDecorations(view, tokens)
  }

  return tokens.length
}

function extractPhraseFromFlag(flag: string): string | null {
  // Try to find quoted text in the flag
  const quoted = flag.match(/"([^"]+)"/)
  if (quoted) return quoted[1]

  // Try to find text before a dash or colon
  const before = flag.match(/^([^—–\-:]+)/)
  if (before) {
    const phrase = before[1].trim()
    if (phrase.length > 3 && phrase.length < 100) return phrase
  }

  return null
}
