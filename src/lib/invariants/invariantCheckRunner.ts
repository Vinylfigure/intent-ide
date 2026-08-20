import type { Node as PMNode } from 'prosemirror-model'
import { collectTextblocks } from '@/lib/prosemirror/blockIds'
import { containsTerm } from '@/lib/graphrag/docGraph'
import { extractChangedTokens } from '@/lib/ai/orchestrator'
import type { Invariant, InvariantCheckKind } from './captureInvariant'

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
 * The LLM/NLI entailment lane for semantic (non-deterministic) facts lives in
 * the sibling `entailmentCheck.ts` (Phase 4, #51) — entailment-kind and
 * inactive rows are silently skipped here, never errored.
 *
 * Known false-negative limitations, disclosed rather than silently assumed
 * away (same discipline as `hasVerbatimConflict`'s own docstring): word-form
 * numbers ("thirty days"), calendar-date fragments, and singular/plural term
 * variants (`containsTerm` is exact-word, not stemmed) are not matched. These
 * make the lane conservative — it can miss a real drift — never the reverse.
 *
 * `classifyCheckKind` below cannot fully close that gap by itself: it decides
 * the lane from the STATEMENT text alone, before any conflicting block
 * exists, so it can confirm a statement has a figure and a subject term but
 * cannot predict whether a future block's phrasing of that same term will
 * survive `containsTerm`'s exact-word match (a plural, a reworded date, a
 * synonym all defeat it silently). What actually closes the gap is
 * `invariantCascade.ts`'s `runAndSurfaceInvariantChecks`: when the entailment
 * lane is on, a `'deterministic'`-classified invariant that this lane finds
 * NO violation for is handed to the entailment lane as a fallback, rather
 * than trusted as clean on classification alone.
 *
 * Known remaining false-positive limitation: a statement whose ONLY
 * substantive term is a single generic word ("the deadline is $500") cannot
 * be made more specific without new NLP — there is nothing left to require
 * "all of" once there is only one term. Two-or-more-term statements (the
 * common case for a real declared fact) are protected; single-term ones are
 * not, and this is a deliberate reuse-only tradeoff, not an oversight.
 */

interface InvariantViolationBase {
  invariantId: string
  statement: string
  /** The invariant's own evidence blocks — never treated as a conflict target. */
  evidenceBlockIds: string[]
  /** The block whose content no longer agrees with the declared statement. */
  conflictBlockId: string
  conflictText: string
}

export interface DeterministicViolation extends InvariantViolationBase {
  checkKind: 'deterministic'
  /** The specific figure the statement declared (verbatim substring of it). */
  statementNumber: string
  /** The specific figure found in the conflicting block (verbatim substring of it). */
  conflictNumber: string
}

export interface EntailmentViolation extends InvariantViolationBase {
  checkKind: 'entailment'
  /** The judge's one-sentence justification — there is no figure to cite here. */
  judgeReason: string
}

/**
 * Discriminated on `checkKind` so the two lanes cannot be confused downstream:
 * a deterministic violation always carries the two figures it compared, an
 * entailment violation never does (that absence is precisely why it needed a
 * judge) and carries the judge's reason instead.
 */
export type InvariantViolation = DeterministicViolation | EntailmentViolation

const NUMERIC_TOKEN_RE = /^[$€£]?\d/

/**
 * Which lane a newly declared fact belongs to, decided at capture time so the
 * ledger row is written with the right `checkKind` instead of the hardcoded
 * `'deterministic'` every caller used through Phase 3.
 *
 * Deliberately mirrors `checkInvariants`'s STATEMENT-side skip gate below
 * rather than inventing a second notion of "deterministically checkable": a
 * statement the deterministic lane would silently `continue` past (no figure,
 * or no substantive subject term to identify WHICH block is about the fact)
 * is exactly the statement that needs the entailment lane. Keeping both reads
 * of `extractChangedTokens` in one file is what stops them drifting apart.
 *
 * What this CANNOT decide, and deliberately does not pretend to: the
 * deterministic lane's *effective* gate is the per-block `containsTerm`
 * subject match, which depends on text that does not exist yet at capture
 * time. So `'deterministic'` here means "worth trying deterministically
 * first", NOT "guaranteed deterministically checkable" — e.g. "each
 * termination requires 30 days notice" classifies deterministic and still
 * misses a later "Terminations now require 45 days." (unstemmed plural).
 * `runAndSurfaceInvariantChecks` is what catches those, by falling such
 * invariants through to the entailment lane when it finds no deterministic
 * violation for them.
 *
 * Local and free — no LLM call is made just to classify.
 */
export function classifyCheckKind(statement: string): InvariantCheckKind {
  const tokens = extractChangedTokens(statement, '')
  const hasNumber = tokens.some((t) => NUMERIC_TOKEN_RE.test(t))
  const hasTerm = tokens.some((t) => !NUMERIC_TOKEN_RE.test(t))
  return hasNumber && hasTerm ? 'deterministic' : 'entailment'
}

function parseBlockIds(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/**
 * Value-equality for numeric tokens, not string-equality: "$30", "30", and
 * "30.00" are the same figure once currency symbols, thousands separators,
 * and decimal-formatting differences are normalized away via a real numeric
 * parse. Comparing raw regex output as strings would false-positive on
 * formatting differences alone (a non-numeric parse — shouldn't happen given
 * the token came from a digit-anchored regex — falls back to the stripped
 * string rather than throwing).
 */
function normalizeNumeric(token: string): string {
  const isPercent = token.endsWith('%')
  const stripped = token.replace(/[$€£,%]/g, '')
  const value = Number(stripped)
  if (!Number.isFinite(value)) return stripped
  return isPercent ? `${value}%` : `${value}`
}

/**
 * Re-evaluate every deterministic, active invariant against the live
 * document. Returns at most one violation per invariant (the first
 * conflicting block found) — enough signal to flag; the cascade review flow
 * is where the user inspects the rest of the document.
 */
export function checkInvariants(doc: PMNode, invariants: Invariant[]): DeterministicViolation[] {
  const blocks = collectTextblocks(doc).filter(
    (b): b is { blockId: string; pos: number; node: (typeof b)['node'] } => Boolean(b.blockId),
  )
  const violations: DeterministicViolation[] = []

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
        checkKind: 'deterministic',
        invariantId: invariant.id,
        statement: invariant.statement,
        evidenceBlockIds,
        conflictBlockId: block.blockId,
        conflictText: blockText,
        // The LAST numeric token, not the first: a statement phrased as "the
        // fee increased from $20 to $30" declares $30 as the current value,
        // and English "from X to Y" / "was X, now Y" phrasing consistently
        // puts the current figure last.
        statementNumber: statementNumbers[statementNumbers.length - 1],
        conflictNumber: blockNumbers[differentIdx],
      })
      break
    }
  }

  return violations
}
