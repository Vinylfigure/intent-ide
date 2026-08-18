import type { Node as PMNode } from 'prosemirror-model'
import { collectTextblocks } from '@/lib/prosemirror/blockIds'
import { containsTerm } from '@/lib/graphrag/docGraph'
import { extractChangedTokens } from '@/lib/ai/orchestrator'
import type { Invariant } from './captureInvariant'

/**
 * Document Invariant Ledger — Phase 2 (issue #32): the deterministic check
 * lane only. Given a document snapshot and its declared invariants, finds
 * blocks that conflict with a previously declared fact — the founder's
 * fixture from #20: declare "terminations are now 30 days", later a "45
 * days" appears elsewhere without ever restating 30.
 *
 * Deliberately reuses the SAME deterministic relation types the cascade's
 * severity-derivation pipeline already uses, rather than adding new
 * extraction logic: `extractChangedTokens` (numeric/figure + substantive-term
 * tokenizing, `orchestrator.ts`) and `containsTerm` (word-boundary matching,
 * `docGraph.ts`). Calling `extractChangedTokens(text, '')` repurposes the
 * before/after diff extractor as a plain tokenizer — nothing in an empty
 * `after` can match, so every token in `text` comes back.
 *
 * The LLM/NLI entailment lane for semantic (non-deterministic) facts is out
 * of scope for this slice (#20's own phasing) — entailment-kind and
 * inactive rows are silently skipped here, never errored.
 *
 * Known false-negative limitations, disclosed rather than silently assumed
 * away (same discipline as `hasVerbatimConflict`'s own docstring): word-form
 * numbers ("thirty days"), calendar-date fragments, and singular/plural term
 * variants (`containsTerm` is exact-word, not stemmed) are not matched. These
 * make the lane conservative — it can miss a real drift — never the reverse.
 */

export interface InvariantViolation {
  invariantId: string
  statement: string
  /** The invariant's own evidence blocks — never treated as a conflict target. */
  evidenceBlockIds: string[]
  /** The block whose content no longer agrees with the declared statement. */
  conflictBlockId: string
  conflictText: string
  /** The specific figure the statement declared (verbatim substring of it). */
  statementNumber: string
  /** The specific figure found in the conflicting block (verbatim substring of it). */
  conflictNumber: string
}

const NUMERIC_TOKEN_RE = /^[$€£]?\d/

function parseBlockIds(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/**
 * Value-equality for numeric tokens, not string-equality: "$30" and "30" (or
 * "1,200" and "1200") are the same figure once currency symbols and
 * thousands separators are stripped. Comparing raw regex output as strings
 * would false-positive on formatting differences alone.
 */
function normalizeNumeric(token: string): string {
  return token.replace(/[$€£,]/g, '')
}

/**
 * Re-evaluate every deterministic, active invariant against the live
 * document. Returns at most one violation per invariant (the first
 * conflicting block found) — enough signal to flag; the cascade review flow
 * is where the user inspects the rest of the document.
 */
export function checkInvariants(doc: PMNode, invariants: Invariant[]): InvariantViolation[] {
  const blocks = collectTextblocks(doc).filter(
    (b): b is { blockId: string; pos: number; node: (typeof b)['node'] } => Boolean(b.blockId),
  )
  const violations: InvariantViolation[] = []

  for (const invariant of invariants) {
    if (invariant.checkKind !== 'deterministic' || invariant.status !== 'active') continue

    const statementTokens = extractChangedTokens(invariant.statement, '')
    const statementNumbers = statementTokens.filter((t) => NUMERIC_TOKEN_RE.test(t))
    const statementTerms = statementTokens.filter((t) => !NUMERIC_TOKEN_RE.test(t))
    // Nothing deterministic to check: no figure means no drift to detect, and
    // no subject term means we can't tell WHICH block is even about this fact.
    if (statementNumbers.length === 0 || statementTerms.length === 0) continue
    const normalizedStatementNumbers = statementNumbers.map(normalizeNumeric)

    // Subject match: for a short (1-2 term) statement — the common case for a
    // declarative fact like "rent is $2,000/month" — a match on a SINGLE
    // generic term degenerates the whole check into "any block mentioning
    // rent with any other number", so require ALL terms. Only once there are
    // enough terms to make "all" fragile does the check relax to the
    // longest (most distinctive) half.
    const bySpecificity = [...statementTerms].sort((a, b) => b.length - a.length)
    const requiredTerms =
      bySpecificity.length <= 2 ? bySpecificity : bySpecificity.slice(0, Math.ceil(bySpecificity.length / 2))

    const evidenceBlockIds = parseBlockIds(invariant.blockIds)

    for (const block of blocks) {
      if (evidenceBlockIds.includes(block.blockId)) continue
      const blockText = block.node.textContent

      const sharesSubject = requiredTerms.every((term) => containsTerm(blockText, term))
      if (!sharesSubject) continue

      const blockNumbers = extractChangedTokens(blockText, '').filter((t) => NUMERIC_TOKEN_RE.test(t))
      if (blockNumbers.length === 0) continue
      const normalizedBlockNumbers = blockNumbers.map(normalizeNumeric)

      // A block that also cites the declared figure is corroborating, not
      // conflicting (e.g. quoting the same "30 days" for context) — only a
      // DIFFERENT figure with the original nowhere in sight counts as drift.
      const hasStatementNumber = normalizedStatementNumbers.some((n) => normalizedBlockNumbers.includes(n))
      if (hasStatementNumber) continue
      const differentIdx = normalizedBlockNumbers.findIndex((n) => !normalizedStatementNumbers.includes(n))
      if (differentIdx === -1) continue

      violations.push({
        invariantId: invariant.id,
        statement: invariant.statement,
        evidenceBlockIds,
        conflictBlockId: block.blockId,
        conflictText: blockText,
        statementNumber: statementNumbers[0],
        conflictNumber: blockNumbers[differentIdx],
      })
      break
    }
  }

  return violations
}
