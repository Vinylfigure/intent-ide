import type { Node as PMNode } from 'prosemirror-model'
import type { LLMConfig } from '@/stores/settingsStore'
import { collectTextblocks } from '@/lib/prosemirror/blockIds'
import { containsTerm, getDocGraph, getNeighborhood, type DocGraph } from '@/lib/graphrag/docGraph'
import { extractChangedTokens } from '@/lib/ai/orchestrator'
import { fetchStructured, type CallStructuredFn } from '@/lib/ai/structuredClient'
import { pickUtilityModel } from '@/lib/ai/modelCapabilities'
import type { Invariant } from './captureInvariant'
import type { EntailmentViolation } from './invariantCheckRunner'

/**
 * Document Invariant Ledger — Phase 4 (issue #51): the LLM entailment lane,
 * for the semantic facts the deterministic lane (`invariantCheckRunner.ts`)
 * discloses it cannot check — word-form numbers ("thirty days"), calendar-date
 * fragments, singular/plural variants, and claims with no exact-match anchor
 * at all. Those statements are routed here at capture time by
 * `classifyCheckKind`; nothing reaches this lane by accident.
 *
 * Trust boundary, inherited verbatim from `relevanceJudge.ts`: the judge only
 * produces a CANDIDATE flag that still flows through the normal HITL cascade
 * surface — it never mutates the ledger and never edits the document. The
 * fail-safe direction is inverted relative to the relevance judge, and
 * deliberately so: there, a malfunction PRESERVES a derived severity the
 * system already believed; here there is no prior belief to preserve, so a
 * thrown call, a malformed reply, or a missing verdict yields NO flag. A
 * broken judge must never manufacture a false positive.
 *
 * Data egress: this lane never runs in the background. It is gated on the
 * explicit `invariantEntailmentEnabled` setting (default OFF, "AI data &
 * spend" panel) and only executes on the same user-initiated apply that the
 * deterministic lane already runs on — never on typing.
 */

/** Judge verdict for one (invariant, candidate block) pair. */
export interface EntailmentVerdict {
  contradicts: boolean
  reason: string
}

/** One (invariant, candidate block) pair put to the judge. */
export interface EntailmentPair {
  invariantId: string
  statement: string
  evidenceBlockIds: string[]
  blockId: string
  blockText: string
}

export type EntailmentJudgeFn = (
  pairs: EntailmentPair[],
  config: LLMConfig,
) => Promise<Map<number, EntailmentVerdict>>

/**
 * Budget caps. The whole point of the graph scoping below is that this lane
 * costs a bounded, predictable amount per run rather than scaling with
 * document length — so the caps are hard, and what they drop is logged rather
 * than silently truncated.
 */
const MAX_INVARIANTS_PER_RUN = 5
const MAX_CANDIDATES_PER_INVARIANT = 6
const MAX_TOTAL_PAIRS = 20
/** How much of a candidate block the judge sees (mirrors relevanceJudge). */
const CONTEXT_MAX_CHARS = 300
/** Neighborhood radius around each evidence block — same 2 hops as the cascade. */
const NEIGHBORHOOD_HOPS = 2

const VERDICT_TOOL = {
  name: 'entailment_verdict',
  description:
    'Deliver your verdict for ONE listed candidate. Call this tool exactly once per candidate, using the [n] index shown in brackets.',
  input_schema: {
    type: 'object',
    properties: {
      index: {
        type: 'number',
        description: 'The [n] index of the candidate this verdict is for.',
      },
      contradicts: {
        type: 'boolean',
        description:
          'true only when the passage cannot both be true and leave the declared fact true — a genuine contradiction, not merely a related topic.',
      },
      reason: {
        type: 'string',
        description: 'One short sentence justifying the verdict.',
      },
    },
    required: ['index', 'contradicts', 'reason'],
  },
}

const JUDGE_SYSTEM =
  'You check whether a passage from a document CONTRADICTS a fact the author declared earlier. Be skeptical and conservative: sharing a topic, restating the fact, adding detail, or describing a different situation are all NOT contradictions. Answer true only when the passage and the declared fact cannot both be true at once. When you are unsure, answer false. For each numbered candidate, call entailment_verdict once with its index.'

/** Safe default for any candidate the judge skipped or garbled: no flag. */
const NO_VERDICT: EntailmentVerdict = { contradicts: false, reason: 'no verdict returned' }

interface VerdictInput {
  index?: unknown
  contradicts?: unknown
  reason?: unknown
}

function pairLine(pair: EntailmentPair, n: number): string {
  return [
    `[${n}] DECLARED FACT: "${pair.statement}"`,
    `PASSAGE: "${pair.blockText.slice(0, CONTEXT_MAX_CHARS)}"`,
  ].join(' | ')
}

/**
 * One batched structured call over every (invariant, block) pair. Returns a
 * verdict for EVERY index: anything the model skipped, duplicated away, or
 * garbled comes back as not-contradicting.
 *
 * Throws when the structured call fails OR when a transport-successful call
 * yields zero valid verdicts (protocol malfunction — the system prompt allows
 * no silent path). Callers treat both as "no flags this run".
 */
export async function judgeEntailmentPairs(
  pairs: EntailmentPair[],
  config: LLMConfig,
  call: CallStructuredFn = fetchStructured,
): Promise<Map<number, EntailmentVerdict>> {
  const verdicts = new Map<number, EntailmentVerdict>()
  if (pairs.length === 0) return verdicts

  const userPrompt = [
    'CANDIDATES (does each passage contradict its declared fact?):',
    ...pairs.map((pair, i) => pairLine(pair, i + 1)),
  ].join('\n')

  const { toolCalls } = await call(
    {
      messages: [
        { role: 'system', content: JUDGE_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      tools: [VERDICT_TOOL],
      maxTokens: Math.min(8000, 400 + 200 * pairs.length),
      temperature: 0,
    },
    // Entailment checking is utility work — route it to the cheap model, the
    // same pin the relevance judge uses.
    { ...config, model: pickUtilityModel(config) },
  )

  for (const tc of toolCalls) {
    if (tc.name !== VERDICT_TOOL.name) continue
    const input = tc.input as VerdictInput
    const n = typeof input?.index === 'number' ? Math.trunc(input.index) : NaN
    if (!Number.isInteger(n) || n < 1 || n > pairs.length) continue
    const parsed: EntailmentVerdict = {
      contradicts: input.contradicts === true,
      reason: typeof input.reason === 'string' && input.reason ? input.reason : 'no reason given',
    }
    // Duplicate indexes: the SAFE answer wins, which here is "no contradiction"
    // — the mirror image of relevanceJudge's deny-wins rule, because there the
    // safe answer was the denial and here it is the absence of a flag.
    const existing = verdicts.get(n - 1)
    if (existing && !existing.contradicts) continue
    verdicts.set(n - 1, parsed)
  }

  if (verdicts.size === 0) {
    throw new Error('entailment judge returned zero valid verdicts')
  }

  for (let i = 0; i < pairs.length; i++) {
    if (!verdicts.has(i)) verdicts.set(i, NO_VERDICT)
  }
  return verdicts
}

function parseBlockIds(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

interface ScoredCandidate {
  blockId: string
  blockText: string
  /** Lower sorts first: graph distance, or PLAIN_TERM_HOP for a term-only hit. */
  hop: number
  sourceRank: number
}

/**
 * Term-only candidates sort after every real graph neighbor. They are a
 * recall floor, not a peer of graph evidence.
 */
const PLAIN_TERM_HOP = Number.MAX_SAFE_INTEGER

/**
 * Candidate blocks for one invariant, bounded two ways rather than scanning
 * the document:
 *
 * 1. The 2-hop deterministic-graph neighborhood of each evidence block — the
 *    same scoping the cascade already uses to decide what a change can affect.
 * 2. Blocks sharing a substantive term with the statement. This is the
 *    deterministic lane's own subject-match signal minus its figure
 *    requirement, and it is what makes the lane actually reach a word-form
 *    fact ("terminations are now thirty days" → blocks about terminations)
 *    in a document whose deterministic graph happens to have no edges at all.
 *
 * Evidence blocks themselves are never candidates — a fact cannot contradict
 * the block that declared it.
 */
export function selectCandidates(
  doc: PMNode,
  invariant: Invariant,
  graph: DocGraph | null,
): EntailmentPair[] {
  const evidenceBlockIds = parseBlockIds(invariant.blockIds)
  const evidence = new Set(evidenceBlockIds)

  const reach = new Map<string, { hop: number; sourceRank: number }>()
  if (graph) {
    for (const evidenceBlockId of evidenceBlockIds) {
      for (const [blockId, entry] of getNeighborhood(graph, evidenceBlockId, NEIGHBORHOOD_HOPS)) {
        const existing = reach.get(blockId)
        if (!existing || entry.hop < existing.hop) reach.set(blockId, { ...entry })
      }
    }
  }

  const terms = extractChangedTokens(invariant.statement, '').filter((t) => !/^[$€£]?\d/.test(t))

  const scored: ScoredCandidate[] = []
  for (const block of collectTextblocks(doc)) {
    const { blockId } = block
    if (!blockId || evidence.has(blockId)) continue
    const blockText = block.node.textContent
    if (!blockText.trim()) continue

    const neighbor = reach.get(blockId)
    const sharesTerm = terms.some((term) => containsTerm(blockText, term))
    if (!neighbor && !sharesTerm) continue

    scored.push({
      blockId,
      blockText,
      hop: neighbor ? neighbor.hop : PLAIN_TERM_HOP,
      sourceRank: neighbor ? neighbor.sourceRank : 0,
    })
  }

  scored.sort((a, b) => a.hop - b.hop || a.sourceRank - b.sourceRank)

  return scored.slice(0, MAX_CANDIDATES_PER_INVARIANT).map((c) => ({
    invariantId: invariant.id,
    statement: invariant.statement,
    evidenceBlockIds,
    blockId: c.blockId,
    blockText: c.blockText,
  }))
}

export interface EntailmentCheckDeps {
  /** Injectable judge (tests: scripted verdicts). */
  judge?: EntailmentJudgeFn
  /** Injectable graph, so tests need not build one. `null` skips graph scoping. */
  graph?: DocGraph | null
}

/**
 * Run the entailment lane over a document's entailment-kind active
 * invariants. Never throws and never returns a flag it is not sure about: any
 * failure anywhere (graph build, judge call, malformed reply) yields an empty
 * result.
 */
export async function checkEntailmentInvariants(
  doc: PMNode,
  invariants: Invariant[],
  config: LLMConfig,
  deps: EntailmentCheckDeps = {},
): Promise<EntailmentViolation[]> {
  const active = invariants.filter(
    (inv) => inv.checkKind === 'entailment' && inv.status === 'active',
  )
  if (active.length === 0) return []

  const considered = active.slice(0, MAX_INVARIANTS_PER_RUN)
  if (considered.length < active.length) {
    console.warn(
      `[invariants] entailment lane capped at ${MAX_INVARIANTS_PER_RUN} invariants; ${active.length - considered.length} not checked this run`,
    )
  }

  try {
    let graph: DocGraph | null
    if (deps.graph !== undefined) {
      graph = deps.graph
    } else {
      // Deterministic-only, exactly as `directEditTrigger` does: a warm cache
      // hit off the background rebuild, and never itself a network call.
      graph = await getDocGraph(doc, config, {
        skipLlm: true,
        skipEmbeddings: true,
        skipGraphiti: true,
      })
    }

    const pairs: EntailmentPair[] = []
    for (const invariant of considered) {
      if (pairs.length >= MAX_TOTAL_PAIRS) break
      const remaining = MAX_TOTAL_PAIRS - pairs.length
      pairs.push(...selectCandidates(doc, invariant, graph).slice(0, remaining))
    }
    if (pairs.length === 0) return []

    const judge: EntailmentJudgeFn =
      deps.judge ?? ((p, c) => judgeEntailmentPairs(p, c))
    const verdicts = await judge(pairs, config)

    const violations: EntailmentViolation[] = []
    const flaggedInvariants = new Set<string>()
    for (let i = 0; i < pairs.length; i++) {
      const verdict = verdicts.get(i)
      if (!verdict?.contradicts) continue
      const pair = pairs[i]
      // At most one violation per invariant, matching the deterministic lane:
      // enough signal to flag; the cascade review surface is where the user
      // inspects the rest.
      if (flaggedInvariants.has(pair.invariantId)) continue
      flaggedInvariants.add(pair.invariantId)
      violations.push({
        checkKind: 'entailment',
        invariantId: pair.invariantId,
        statement: pair.statement,
        evidenceBlockIds: pair.evidenceBlockIds,
        conflictBlockId: pair.blockId,
        conflictText: pair.blockText,
        judgeReason: verdict.reason,
      })
    }
    return violations
  } catch (err) {
    // Fail safe: a broken judge produces no flags, never a false positive.
    console.warn('[invariants] Entailment lane failed:', err)
    return []
  }
}
