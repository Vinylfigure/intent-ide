import type { Node as PMNode } from 'prosemirror-model'
import type { ProposedEdit } from '@/lib/annotations/types'
import type { LLMConfig } from '@/stores/settingsStore'
import { findBlockById } from '@/lib/prosemirror/blockIds'
import { fetchStructured, type CallStructuredFn } from '@/lib/ai/structuredClient'
import { pickUtilityModel } from '@/lib/ai/modelCapabilities'

/**
 * LLM relevance judge for 'must' cascade candidates.
 *
 * hasVerbatimConflict is a string check: a stale-looking token in the target
 * block proves nothing about MEANING (the same figure can describe an
 * unrelated cost). Before a candidate keeps its derived 'must' severity, one
 * batched structured call re-examines each citation and confirms or denies
 * that the evidence genuinely conflicts with the target passage. The judge
 * only confirms/denies conflicts — the model never sees or emits a severity;
 * the caller demotes non-confirmed candidates. Skeptical defaults throughout:
 * a missing verdict means NOT confirmed — but ONLY when the judge engaged at
 * all. A transport-successful call that yields ZERO valid verdicts is a
 * protocol malfunction (prose reply, truncation, model confusion), not an
 * all-deny: the system prompt gives the model no legitimate silent path, so
 * that case throws and callers keep derived severities, exactly like a
 * network failure.
 */

export interface JudgeVerdict {
  genuinelyConflicts: boolean
  reason: string
}

/** The primary edit's before/after text — context the judge needs to assess staleness. */
export interface JudgePrimary {
  before: string
  newText: string
}

/**
 * Judge contract used by the cascade: returns one verdict per candidate,
 * keyed by the candidate's index in the input array.
 */
export type JudgeFn = (
  candidates: ProposedEdit[],
  primary: JudgePrimary,
  doc: PMNode,
  config: LLMConfig,
) => Promise<Map<number, JudgeVerdict>>

const VERDICT_TOOL = {
  name: 'verdict',
  description:
    'Deliver your verdict for ONE listed candidate. Call this tool exactly once per candidate, using the [n] index shown in brackets.',
  input_schema: {
    type: 'object',
    properties: {
      index: {
        type: 'number',
        description: 'The [n] index of the candidate this verdict is for.',
      },
      genuinely_conflicts: {
        type: 'boolean',
        description:
          'true only when the cited evidence genuinely makes the target passage stale or contradictory given the primary change.',
      },
      reason: {
        type: 'string',
        description: 'One short sentence justifying the verdict.',
      },
    },
    required: ['index', 'genuinely_conflicts', 'reason'],
  },
}

const JUDGE_SYSTEM =
  'You verify whether cited evidence GENUINELY conflicts with a target passage. Be skeptical: matching words or figures are not enough — the target passage is only in conflict if the primary change actually makes it stale, wrong, or contradictory in meaning. A coincidental match (the same number describing something unrelated, a citation about a different subject) does not conflict. For each numbered candidate, call verdict once with its index.'

const NO_VERDICT: JudgeVerdict = {
  genuinelyConflicts: false,
  reason: 'no verdict returned',
}

interface VerdictInput {
  index?: unknown
  genuinely_conflicts?: unknown
  reason?: unknown
}

/** How much of the target block's text the judge sees per candidate. */
const CONTEXT_MAX_CHARS = 300

/**
 * The target block's surrounding text — without it the judge cannot tell a
 * coincidental figure ("the 2019 renovation also cost $50,000") from a
 * genuine conflict. Falls back to the target text when the block no longer
 * resolves in the live doc.
 */
function candidateContext(edit: ProposedEdit, doc: PMNode): string {
  const blockText = edit.blockId
    ? findBlockById(doc, edit.blockId)?.node.textContent
    : undefined
  return (blockText ?? edit.targetText).slice(0, CONTEXT_MAX_CHARS)
}

function candidateLine(
  edit: ProposedEdit,
  n: number,
  primary: JudgePrimary,
  doc: PMNode,
): string {
  return [
    `[${n}] TARGET (block ${edit.blockId ?? 'unknown'}): "${edit.targetText}"`,
    `CONTEXT: "${candidateContext(edit, doc)}"`,
    `CITED: "${edit.evidence?.quotedText ?? ''}"`,
    `PRIMARY was "${primary.before}" now "${primary.newText}"`,
  ].join(' | ')
}

/**
 * One batched structured call over all candidates (ProposedEdits derived
 * 'must' with non-null evidence). Returns a verdict for EVERY candidate
 * index: any index the model skipped, duplicated away, or garbled comes back
 * as not-confirmed. Throws when the structured call itself fails OR when a
 * transport-successful call produces zero valid verdicts (protocol
 * malfunction — the prompt allows no silent path) — callers treat both as
 * "keep derived severities" (best-effort, never blocks).
 */
export async function judgeMustCandidates(
  candidates: ProposedEdit[],
  primary: JudgePrimary,
  doc: PMNode,
  config: LLMConfig,
  call: CallStructuredFn = fetchStructured,
): Promise<Map<number, JudgeVerdict>> {
  const verdicts = new Map<number, JudgeVerdict>()
  if (candidates.length === 0) return verdicts

  const userPrompt = [
    'CANDIDATES (verify each cited conflict):',
    ...candidates.map((edit, i) => candidateLine(edit, i + 1, primary, doc)),
  ].join('\n')

  const { toolCalls } = await call(
    {
      messages: [
        { role: 'system', content: JUDGE_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      tools: [VERDICT_TOOL],
      // Each verdict tool_use block costs ~60-120 output tokens; a flat cap
      // truncates the tail of large batches into silent demotions.
      maxTokens: Math.min(8000, 400 + 200 * candidates.length),
      temperature: 0,
    },
    // Verdict checking is utility work — route it to the cheap model.
    { ...config, model: pickUtilityModel(config) },
  )

  for (const tc of toolCalls) {
    if (tc.name !== 'verdict') continue
    const input = tc.input as VerdictInput
    const n = typeof input?.index === 'number' ? Math.trunc(input.index) : NaN
    if (!Number.isInteger(n) || n < 1 || n > candidates.length) continue
    const parsed: JudgeVerdict = {
      genuinelyConflicts: input.genuinely_conflicts === true,
      reason: typeof input.reason === 'string' && input.reason ? input.reason : 'no reason given',
    }
    // Duplicate indexes: first write wins, except a deny always sticks — a
    // later confirm may not launder an earlier denial (and vice versa a later
    // deny overrides an earlier confirm).
    const existing = verdicts.get(n - 1)
    if (existing) {
      if (!existing.genuinelyConflicts || parsed.genuinelyConflicts) continue
    }
    verdicts.set(n - 1, parsed)
  }

  // Zero valid verdicts on a successful call is a malfunction, not an
  // all-deny: the system prompt requires one verdict per candidate, so a
  // silent reply means prose, truncation, or confusion. Throw so the caller
  // preserves derived severities — exactly like a failed call.
  if (verdicts.size === 0) {
    throw new Error('relevance judge returned zero valid verdicts')
  }

  // Skeptical default: with the judge demonstrably engaged, every candidate
  // it individually skipped, duplicated away, or garbled is NOT confirmed.
  for (let i = 0; i < candidates.length; i++) {
    if (!verdicts.has(i)) verdicts.set(i, NO_VERDICT)
  }
  return verdicts
}
