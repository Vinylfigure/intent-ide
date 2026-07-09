import type { Node as PMNode } from 'prosemirror-model'
import type { ProposedEdit } from '@/lib/annotations/types'
import type { LLMConfig } from '@/stores/settingsStore'
import { fetchStructured, type CallStructuredFn } from '@/lib/ai/structuredClient'

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
 * a missing verdict means NOT confirmed.
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

function candidateLine(edit: ProposedEdit, n: number, primary: JudgePrimary): string {
  return [
    `[${n}] TARGET (block ${edit.blockId ?? 'unknown'}): "${edit.targetText}"`,
    `CITED: "${edit.evidence?.quotedText ?? ''}"`,
    `PRIMARY was "${primary.before}" now "${primary.newText}"`,
  ].join(' | ')
}

/**
 * One batched structured call over all candidates (ProposedEdits derived
 * 'must' with non-null evidence). Returns a verdict for EVERY candidate
 * index: any index the model skipped, duplicated away, or garbled comes back
 * as not-confirmed. Throws only when the structured call itself fails —
 * callers treat that as "keep derived severities" (best-effort, never blocks).
 */
export async function judgeMustCandidates(
  candidates: ProposedEdit[],
  primary: JudgePrimary,
  doc: PMNode,
  config: LLMConfig,
  call: CallStructuredFn = fetchStructured,
): Promise<Map<number, JudgeVerdict>> {
  void doc // reserved: block-level context could be added to the prompt later
  const verdicts = new Map<number, JudgeVerdict>()
  if (candidates.length === 0) return verdicts

  const userPrompt = [
    'CANDIDATES (verify each cited conflict):',
    ...candidates.map((edit, i) => candidateLine(edit, i + 1, primary)),
  ].join('\n')

  const { toolCalls } = await call(
    {
      messages: [
        { role: 'system', content: JUDGE_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      tools: [VERDICT_TOOL],
      maxTokens: 1000,
      temperature: 0,
    },
    config,
  )

  for (const tc of toolCalls) {
    if (tc.name !== 'verdict') continue
    const input = tc.input as VerdictInput
    const n = typeof input?.index === 'number' ? Math.trunc(input.index) : NaN
    if (!Number.isInteger(n) || n < 1 || n > candidates.length) continue
    verdicts.set(n - 1, {
      genuinelyConflicts: input.genuinely_conflicts === true,
      reason: typeof input.reason === 'string' && input.reason ? input.reason : 'no reason given',
    })
  }

  // Skeptical default: every candidate without a usable verdict is NOT confirmed.
  for (let i = 0; i < candidates.length; i++) {
    if (!verdicts.has(i)) verdicts.set(i, NO_VERDICT)
  }
  return verdicts
}
