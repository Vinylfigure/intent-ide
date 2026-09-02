import type { LLMConfig } from '@/stores/settingsStore'
import type { RelatedPassage } from '@/lib/ai/intentContext'
import { fetchStructured, type CallStructuredFn } from '@/lib/ai/structuredClient'
import { pickUtilityModel } from '@/lib/ai/modelCapabilities'

/**
 * LLM second opinion on the "Touches N other passages" blast-radius preview.
 *
 * `relevanceScore.ts` is a cheap, synchronous, local heuristic — IDF
 * vocabulary overlap plus edge provenance — good enough to run on mouse-up,
 * but it is still a heuristic: it can keep a passage that a human would call
 * irrelevant (shared words, not shared subject matter). This is the opt-in,
 * click-triggered second opinion: one batched structured call re-examines
 * every candidate against the seed passage and confirms or denies that it
 * genuinely bears on it. Mirrors `relevanceJudge.ts` deliberately — same
 * verdict-tool shape, same skeptical defaults, same trust boundary.
 *
 * A missing verdict means NOT related — but ONLY when the judge engaged at
 * all. A transport-successful call that yields ZERO valid verdicts is a
 * protocol malfunction (prose reply, truncation, model confusion), not an
 * all-deny: the system prompt gives the model no legitimate silent path, so
 * that case THROWS and the caller keeps the heuristic result (every passage
 * shown as before) rather than silently discarding every passage.
 */

export interface PassageVerdict {
  related: boolean
  reason: string
}

/** The passage the candidates are being judged against. */
export interface JudgeSeed {
  text: string
  headingPath: string[]
}

/**
 * Judge contract: returns one verdict per candidate, keyed by the
 * candidate's index in the input array.
 */
export type JudgeRelatedFn = (
  seed: JudgeSeed,
  candidates: RelatedPassage[],
  config: LLMConfig,
) => Promise<Map<number, PassageVerdict>>

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
      genuinely_related: {
        type: 'boolean',
        description:
          'true only when this passage genuinely bears on the seed passage — shares subject matter, not just words.',
      },
      reason: {
        type: 'string',
        description: 'One short sentence justifying the verdict.',
      },
    },
    required: ['index', 'genuinely_related', 'reason'],
  },
}

const JUDGE_SYSTEM =
  'You verify whether a candidate passage GENUINELY bears on a seed passage. Be skeptical: shared words are not shared subject matter. A passage that merely mentions the same project name, the same generic term, or overlaps in vocabulary is NOT related unless it actually informs, constrains, or depends on the seed. The honest answer to "does this bear on it" is usually no — most documents mention the same handful of nouns everywhere without those mentions being substantively connected. For each numbered candidate, call verdict once with its index.'

const NO_VERDICT: PassageVerdict = {
  related: false,
  reason: 'no verdict returned',
}

interface VerdictInput {
  index?: unknown
  genuinely_related?: unknown
  reason?: unknown
}

/** How much of the seed/candidate text the judge sees. */
const TEXT_MAX_CHARS = 400

function truncateForPrompt(text: string): string {
  return text.length <= TEXT_MAX_CHARS ? text : `${text.slice(0, TEXT_MAX_CHARS - 1)}…`
}

function seedLine(seed: JudgeSeed): string {
  const where = seed.headingPath.length ? ` [${seed.headingPath.join(' › ')}]` : ''
  return `SEED${where}: "${truncateForPrompt(seed.text)}"`
}

function candidateLine(passage: RelatedPassage, n: number): string {
  const where = passage.headingPath.length ? ` [${passage.headingPath.join(' › ')}]` : ''
  return [
    `[${n}] CANDIDATE${where}: "${truncateForPrompt(passage.text)}"`,
    `HEURISTIC WHY: "${passage.why}" (score ${passage.score.toFixed(2)}, hop ${passage.hop})`,
  ].join(' | ')
}

/**
 * One batched structured call over all candidates. Returns a verdict for
 * EVERY candidate index: any index the model skipped, duplicated away, or
 * garbled comes back as not-related. Throws when the structured call itself
 * fails OR when a transport-successful call produces zero valid verdicts
 * (protocol malfunction — the prompt allows no silent path) — the caller
 * treats both as "keep the heuristic result" (never destroys the first
 * opinion).
 */
export async function judgeRelatedPassages(
  seed: JudgeSeed,
  candidates: RelatedPassage[],
  config: LLMConfig,
  call: CallStructuredFn = fetchStructured,
): Promise<Map<number, PassageVerdict>> {
  const verdicts = new Map<number, PassageVerdict>()
  if (candidates.length === 0) return verdicts

  const userPrompt = [
    seedLine(seed),
    '',
    'CANDIDATES (verify each one genuinely bears on the seed above):',
    ...candidates.map((passage, i) => candidateLine(passage, i + 1)),
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
    const parsed: PassageVerdict = {
      related: input.genuinely_related === true,
      reason: typeof input.reason === 'string' && input.reason ? input.reason : 'no reason given',
    }
    // Duplicate indexes: first write wins, except a deny always sticks — a
    // later confirm may not launder an earlier denial (and vice versa a later
    // deny overrides an earlier confirm).
    const existing = verdicts.get(n - 1)
    if (existing) {
      if (!existing.related || parsed.related) continue
    }
    verdicts.set(n - 1, parsed)
  }

  // Zero valid verdicts on a successful call is a malfunction, not an
  // all-deny: the system prompt requires one verdict per candidate, so a
  // silent reply means prose, truncation, or confusion. Throw so the caller
  // preserves the heuristic result — exactly like a network failure.
  if (verdicts.size === 0) {
    throw new Error('related-passage judge returned zero valid verdicts')
  }

  // Skeptical default: with the judge demonstrably engaged, every candidate
  // it individually skipped, duplicated away, or garbled is NOT related.
  for (let i = 0; i < candidates.length; i++) {
    if (!verdicts.has(i)) verdicts.set(i, NO_VERDICT)
  }
  return verdicts
}
