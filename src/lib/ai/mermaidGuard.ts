/**
 * Mermaid render guard (Flow v1 "Diagram this"): before a resolution whose
 * content carries a ```mermaid fence is finalized, validate that the diagram
 * actually parses. If it does not, ask the resolver for ONE correction; if
 * that still fails, degrade the fence to a plain code block so the card shows
 * readable source instead of a broken diagram. Fail-open everywhere — the
 * guard must never block or lose an answer.
 */

export interface MermaidFenceMatch {
  /** The diagram source inside the fence (without the fence lines). */
  code: string
  /** The full fenced block as matched in the content. */
  fence: string
}

// First ```mermaid / ~~~mermaid fence: opening line, body, matching closer.
const MERMAID_FENCE_RE =
  /(?:^|\n)[ \t]*(```+|~~~+)[ \t]*mermaid[^\n]*\n([\s\S]*?)\n[ \t]*\1[ \t]*(?=\n|$)/

/** Extract the FIRST mermaid fence from markdown content, or null. */
export function extractMermaidFence(content: string): MermaidFenceMatch | null {
  const match = MERMAID_FENCE_RE.exec(content)
  if (!match) return null
  return { code: match[2], fence: match[0] }
}

let mermaidInitialized = false

/**
 * Validate mermaid source via the real parser (dynamic import, initialized
 * once with strict security). SSR/node-safe: with no `window` the parser
 * cannot run, so validation passes (fail-open).
 */
export async function validateMermaid(
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof window === 'undefined') return { ok: true }
  try {
    const mermaid = (await import('mermaid')).default
    if (!mermaidInitialized) {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
      mermaidInitialized = true
    }
    await mermaid.parse(code)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Degrade mermaid fences to plain fences (language token removed) so the
 * source renders as an ordinary code block instead of a broken diagram.
 */
export function degradeMermaidToProse(content: string): string {
  return content.replace(/(^|\n)([ \t]*(?:```+|~~~+))[ \t]*mermaid[^\n]*/g, '$1$2')
}

/**
 * Ensure `content` is renderable:
 * - no mermaid fence → content as-is;
 * - fence validates → content as-is;
 * - otherwise retry ONCE (the callback receives the parse error text and
 *   returns replacement content): a retry whose fence validates — or that
 *   has no fence at all (plain-prose fallback) — wins; anything else
 *   degrades the ORIGINAL content's fence to a plain code block.
 *
 * Callback contract: `retry` MUST throw when its underlying request failed.
 * A returned fence-less string is trusted as a deliberate plain-prose answer,
 * so returning an error-shaped string instead of throwing silently replaces
 * the original answer with it.
 */
export async function ensureRenderableMermaid(
  content: string,
  retry: (correction: string) => Promise<string>,
): Promise<string> {
  const match = extractMermaidFence(content)
  if (!match) return content

  const result = await validateMermaid(match.code)
  if (result.ok) return content

  let retried: string
  try {
    retried = await retry(result.error)
  } catch {
    return degradeMermaidToProse(content)
  }

  const retriedMatch = extractMermaidFence(retried)
  if (!retriedMatch) return retried
  const retriedResult = await validateMermaid(retriedMatch.code)
  if (retriedResult.ok) return retried
  return degradeMermaidToProse(content)
}
