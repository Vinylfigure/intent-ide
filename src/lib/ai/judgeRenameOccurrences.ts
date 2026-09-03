import type { LLMConfig } from '@/stores/settingsStore'
import { fetchStructured, type CallStructuredFn } from '@/lib/ai/structuredClient'
import { pickUtilityModel } from '@/lib/ai/modelCapabilities'

/**
 * LLM second opinion on which remaining mentions of a renamed name are the
 * same referent.
 *
 * `renameDetect.ts` is deterministic and local: whole-word matching, minus the
 * cases that are categorically not narrative reference (quotations, email
 * addresses, URLs). That is a good first pass and a bad last one — the string
 * "Cody" can be a different Cody, a product, a place, or a codename, and no
 * amount of string matching separates those.
 *
 * This is the judgement pass, and it runs ONLY after the reader clicks Check.
 * Nothing here applies an edit; it labels candidates so a human reviews the
 * ambiguous ones with their sentence in front of them.
 *
 * Mirrors judgeRelatedPassages deliberately — same verdict-tool shape, same
 * skeptical default, same trust boundary. A missing verdict means "ask the
 * human", never "rename it anyway": the asymmetry matters because a wrong
 * silent rewrite costs far more trust than one extra confirmation click.
 */

export interface RenameVerdict {
  /** True only when this mention is confidently the same thing being renamed. */
  sameReferent: boolean
  reason: string
}

export interface RenameOccurrenceInput {
  /** The sentence the mention sits in — the context a judgement needs. */
  sentence: string
}

export type JudgeRenameFn = (
  rename: { from: string; to: string },
  occurrences: RenameOccurrenceInput[],
  config: LLMConfig,
) => Promise<Map<number, RenameVerdict>>

const VERDICT_TOOL = {
  name: 'verdict',
  description:
    'Deliver your verdict for ONE listed mention. Call this tool exactly once per mention, using the [n] index shown in brackets.',
  input_schema: {
    type: 'object',
    properties: {
      index: {
        type: 'number',
        description: 'The [n] index of the mention this verdict is for.',
      },
      same_referent: {
        type: 'boolean',
        description:
          'true only when this mention clearly refers to the same thing the reader just renamed.',
      },
      reason: {
        type: 'string',
        description: 'One short sentence justifying the verdict.',
      },
    },
    required: ['index', 'same_referent', 'reason'],
  },
}

const JUDGE_SYSTEM = [
  'A reader renamed something in a document. You decide which remaining mentions of the OLD name refer to the same thing and should follow, and which are a different thing that must be left alone.',
  'Be skeptical. The same string very often names different things in one document: a different person with the same name, a product or codename, a place, a team, a file or variable name, or a word being discussed rather than used.',
  'Say same_referent only when the sentence makes it clear. When the sentence is ambiguous, answer false — a human will look at it, which is cheap, whereas a wrong rewrite of the wrong thing is expensive.',
  'For each numbered mention, call verdict exactly once with its index.',
].join(' ')

/** Ask the human. Never "rename it anyway". */
const NO_VERDICT: RenameVerdict = {
  sameReferent: false,
  reason: 'no verdict returned — needs a human',
}

interface VerdictInput {
  index?: unknown
  same_referent?: unknown
  reason?: unknown
}

const SENTENCE_MAX_CHARS = 300

function truncateForPrompt(text: string): string {
  return text.length <= SENTENCE_MAX_CHARS ? text : `${text.slice(0, SENTENCE_MAX_CHARS - 1)}…`
}

/**
 * One batched structured call over every candidate mention. Returns a verdict
 * for EVERY index: anything the model skipped, duplicated away or garbled comes
 * back as "needs a human".
 *
 * Throws when the structured call fails, or when a transport-successful call
 * produces zero valid verdicts — a protocol malfunction, since the prompt
 * allows no silent path. The caller treats both as "show every candidate
 * unjudged" rather than silently deciding for the reader.
 */
export async function judgeRenameOccurrences(
  rename: { from: string; to: string },
  occurrences: RenameOccurrenceInput[],
  config: LLMConfig,
  call: CallStructuredFn = fetchStructured,
): Promise<Map<number, RenameVerdict>> {
  const verdicts = new Map<number, RenameVerdict>()
  if (occurrences.length === 0) return verdicts

  const userPrompt = [
    `RENAME: the reader changed "${rename.from}" to "${rename.to}".`,
    '',
    `MENTIONS of "${rename.from}" still in the document (decide which refer to the same thing):`,
    ...occurrences.map((o, i) => `[${i + 1}] "${truncateForPrompt(o.sentence)}"`),
  ].join('\n')

  const { toolCalls } = await call(
    {
      messages: [
        { role: 'system', content: JUDGE_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      tools: [VERDICT_TOOL],
      // Each verdict block costs roughly 60-120 output tokens; a flat cap
      // truncates the tail of a large batch into silent "needs a human".
      maxTokens: Math.min(8000, 400 + 200 * occurrences.length),
      temperature: 0,
    },
    // Verdict checking is utility work — route it to the cheap model.
    { ...config, model: pickUtilityModel(config) },
  )

  let valid = 0
  for (const tc of toolCalls) {
    if (tc.name !== 'verdict') continue
    const input = tc.input as VerdictInput
    const n = typeof input?.index === 'number' ? Math.trunc(input.index) : NaN
    const zeroBased = n - 1
    if (!Number.isFinite(zeroBased) || zeroBased < 0 || zeroBased >= occurrences.length) continue
    if (verdicts.has(zeroBased)) continue
    verdicts.set(zeroBased, {
      sameReferent: input.same_referent === true,
      reason: typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim() : '—',
    })
    valid++
  }

  if (valid === 0) {
    throw new Error('rename judge returned no usable verdicts')
  }

  for (let i = 0; i < occurrences.length; i++) {
    if (!verdicts.has(i)) verdicts.set(i, NO_VERDICT)
  }
  return verdicts
}
