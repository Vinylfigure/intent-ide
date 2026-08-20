import type { EditorState } from 'prosemirror-state'
import type { SuggestedEdit, ProposedEdit } from '@/lib/annotations/types'
import { SEVERITY_ORDER } from '@/lib/annotations/types'
import type { LLMConfig } from '@/stores/settingsStore'
import { collectTextblocks, blockIdAtPos } from '@/lib/prosemirror/blockIds'
import { fetchStructured, type CallStructuredFn } from '@/lib/ai/structuredClient'
import { pickUtilityModel } from '@/lib/ai/modelCapabilities'
import type { JudgeFn } from '@/lib/ai/relevanceJudge'
import {
  PROPOSE_EDIT_TOOL,
  resolveProposedEdits,
  applyRelevanceJudge,
  proposeCascadeEdits,
  type CascadeOptions,
} from '@/lib/ai/orchestrator'
import { buildDeterministicGraph, getNeighborhood, type DocGraph } from './docGraph'

/**
 * Ablation-study arms for issue #19's graph-scoped-vs-whole-doc cascade
 * question. Scaffolding only — see #27: this module makes every arm runnable
 * against the SCRIPTED model (no live provider key), so the harness is one
 * `bench:live`-style run away from a verdict the moment a key is available.
 * Arm A (whole-doc single pass, no verify) is intentionally NOT implemented
 * here — issue #27 scopes it out; only B, D, and E (cheap-model variants of
 * B/C/D) are built alongside the existing arm C baseline (`proposeCascadeEdits`).
 *
 * Design choice held constant across arms: candidate parsing, blockId
 * anchoring, evidence verification, and numeric-conflict severity derivation
 * all run through the SAME `resolveProposedEdits` helper the production
 * pipeline (arm C) uses. Arms differ in candidate SCOPING — arm D free-edits
 * the whole document in one pass, arm B plans over the whole document then
 * patches only the planned blocks, arm C sends only a 2-hop graph
 * neighborhood — and in what "verify" pass runs after generation (LLM judge
 * for B/C, deterministic-graph repair for D). That isolates the variables the
 * ablation is actually testing instead of also varying the anchoring/evidence
 * substrate, which would confound the comparison.
 */

export type ArmId = 'B' | 'C' | 'D'

export interface AblationOptions {
  callStructured?: CallStructuredFn
  /** Arm B's self-verify judge override (defaults like the production judge). */
  judge?: JudgeFn
  /** Pre-built graph — arm C only (passed through to proposeCascadeEdits). */
  graph?: DocGraph
  /**
   * Route GENERATION (arm B's plan + patch calls; arm C/D's single call)
   * through pickUtilityModel — arm E. Self-verify is NOT affected by this
   * flag: `judgeMustCandidates` already unconditionally pins every judge call
   * (arm B's self-verify, arm C's production judge) to the utility model
   * regardless of `cheapModel` — see relevanceJudge.ts. So B vs cheap-B only
   * differs in what generated the candidates, not in verify cost.
   */
  cheapModel?: boolean
  /** Deterministic-graph connectivity radius for arm D's repair step. */
  hops?: number
}

const WHOLE_DOC_SYSTEM =
  'You keep a document internally consistent. You are given a primary edit and the FULL document, each block listed as [blockId] text. Find blocks that become inconsistent, outdated, or contradictory because of the primary edit and call propose_edit once for each. Only edit listed blocks; reference them by their block_id. Copy target_text verbatim from the block. Never propose an edit to the primary block itself. Cite your evidence: source_block_id plus a verbatim quoted_text showing the conflict. If nothing needs to change, call nothing.'

// --- Arm B: plan-then-patch ------------------------------------------------

const PLAN_TOOL = {
  name: 'plan_edit',
  description:
    'Identify ONE block that becomes inconsistent, outdated, or contradictory because of the primary edit — planning only, no replacement text yet. Call once per affected block. Never plan the primary block itself.',
  input_schema: {
    type: 'object',
    properties: {
      block_id: { type: 'string', description: 'Id of the affected block.' },
      reason: { type: 'string', description: 'Why this block is affected.' },
    },
    required: ['block_id'],
  },
}

const PLAN_SYSTEM =
  'You keep a document internally consistent. You are given a primary edit and the FULL document, each block listed as [blockId] text. PLAN which blocks become inconsistent, outdated, or contradictory because of the primary edit — call plan_edit once per affected block. Do NOT write replacement text yet; that is a later step. Never plan the primary block itself. If nothing is affected, call nothing.'

const PATCH_SYSTEM =
  'You write the replacement text for blocks a prior planning pass already identified as affected by a primary edit. For each listed block, call propose_edit with the exact verbatim target_text to replace, its replacement new_text, and evidence (source_block_id + verbatim quoted_text) showing the conflict. Only patch the listed blocks.'

interface PlanInput {
  block_id?: unknown
  reason?: unknown
}

/** Parse a plan-stage response into unique, in-scope block ids. */
function parsePlannedBlockIds(
  toolCalls: { name: string; input: unknown }[],
  allBlockIds: ReadonlySet<string>,
  primaryBlockId: string,
): string[] {
  const planned: string[] = []
  const seen = new Set<string>()
  for (const tc of toolCalls) {
    const input = tc.input as PlanInput
    const blockId = typeof input?.block_id === 'string' ? input.block_id : undefined
    if (!blockId || blockId === primaryBlockId) continue
    if (!allBlockIds.has(blockId) || seen.has(blockId)) continue
    seen.add(blockId)
    planned.push(blockId)
  }
  return planned
}

function primaryBeforeText(state: EditorState, primary: SuggestedEdit): string {
  const doc = state.doc
  return doc.textBetween(
    Math.min(primary.from, doc.content.size),
    Math.min(primary.to, doc.content.size),
  )
}

function effectiveConfig(config: LLMConfig, cheapModel?: boolean): LLMConfig {
  return cheapModel ? { ...config, model: pickUtilityModel(config) } : config
}

/**
 * Generate free (unscoped) proposals over every textblock in the document —
 * arm D's single whole-doc pass (arm B has its own two-stage plan+patch
 * calls below). Best-effort: any transport failure degrades to zero
 * proposals, same contract as the graph-scoped pipeline.
 */
async function generateWholeDocProposals(
  state: EditorState,
  primary: SuggestedEdit,
  primaryBlockId: string,
  primaryBefore: string,
  config: LLMConfig,
  call: CallStructuredFn,
): Promise<ProposedEdit[]> {
  const doc = state.doc
  const blocks = collectTextblocks(doc).filter((b) => b.blockId)
  const allBlockIds = new Set(blocks.map((b) => b.blockId!))

  const userPrompt = [
    `PRIMARY EDIT (in block [${primaryBlockId}], just applied or about to apply):`,
    `- Was: "${primaryBefore}"`,
    `- Now: "${primary.newText}"`,
    '',
    'DOCUMENT BLOCKS (the only blocks you may edit):',
    ...blocks.map((b) => `[${b.blockId}] ${b.node.textContent}`),
  ].join('\n')

  let toolCalls: { name: string; input: unknown }[]
  try {
    const res = await call(
      {
        messages: [
          { role: 'system', content: WHOLE_DOC_SYSTEM },
          { role: 'user', content: userPrompt },
        ],
        tools: [PROPOSE_EDIT_TOOL],
        maxTokens: 4000,
        temperature: 0.2,
      },
      config,
    )
    toolCalls = res.toolCalls
  } catch {
    return []
  }

  return resolveProposedEdits(doc, toolCalls, allBlockIds, primary, primaryBefore)
}

/**
 * Arm B — whole-doc plan-then-patch + self-verify: THREE real structured
 * calls, matching issue #19's arm definition literally rather than
 * collapsing it into "single pass + verify" (which is arm A, not B).
 *
 * 1. PLAN: whole document, plan_edit tool — identify affected blocks only,
 *    no replacement text.
 * 2. PATCH: only the planned blocks, propose_edit tool — write the actual
 *    replacement + evidence. Scoped narrower than the plan call by design:
 *    patching should reason about the specific passages the plan flagged,
 *    not the whole document again.
 * 3. SELF-VERIFY: the same LLM judge arm C's production judge uses,
 *    re-examining every derived 'must' and demoting unconfirmed ones.
 *
 * Under the scripted test harness all three calls hit the same canned
 * response list (a script has no concept of "this is the plan prompt vs the
 * patch prompt"), so the scripted result is identical to a single-call
 * version — but the CALL STRUCTURE is real, and a live model sees a
 * genuinely different, narrower prompt at each stage.
 */
export async function runArmB(
  state: EditorState,
  primary: SuggestedEdit,
  config: LLMConfig,
  opts: AblationOptions = {},
): Promise<ProposedEdit[]> {
  const doc = state.doc
  const primaryBlockId = blockIdAtPos(doc, primary.from)
  if (!primaryBlockId) {
    console.warn('ablation arm B: primary edit has no blockId — skipping')
    return []
  }

  const cfg = effectiveConfig(config, opts.cheapModel)
  const call = opts.callStructured ?? fetchStructured
  const primaryBefore = primaryBeforeText(state, primary)

  const blocks = collectTextblocks(doc).filter((b) => b.blockId)
  const allBlockIds = new Set(blocks.map((b) => b.blockId!))

  const wholeDocPrompt = [
    `PRIMARY EDIT (in block [${primaryBlockId}], just applied or about to apply):`,
    `- Was: "${primaryBefore}"`,
    `- Now: "${primary.newText}"`,
    '',
    'DOCUMENT BLOCKS:',
    ...blocks.map((b) => `[${b.blockId}] ${b.node.textContent}`),
  ].join('\n')

  // 1. Plan.
  let planCalls: { name: string; input: unknown }[]
  try {
    const res = await call(
      {
        messages: [
          { role: 'system', content: PLAN_SYSTEM },
          { role: 'user', content: wholeDocPrompt },
        ],
        tools: [PLAN_TOOL],
        maxTokens: 1500,
        temperature: 0.2,
      },
      cfg,
    )
    planCalls = res.toolCalls
  } catch {
    return []
  }
  const plannedBlockIds = parsePlannedBlockIds(planCalls, allBlockIds, primaryBlockId)
  if (plannedBlockIds.length === 0) return []

  // 2. Patch — scoped to only the planned blocks.
  const plannedSet = new Set(plannedBlockIds)
  const patchPrompt = [
    `PRIMARY EDIT (in block [${primaryBlockId}], just applied or about to apply):`,
    `- Was: "${primaryBefore}"`,
    `- Now: "${primary.newText}"`,
    '',
    'BLOCKS A PRIOR PLANNING PASS FLAGGED AS AFFECTED (patch each):',
    ...blocks
      .filter((b) => plannedSet.has(b.blockId!))
      .map((b) => `[${b.blockId}] ${b.node.textContent}`),
  ].join('\n')

  let patchCalls: { name: string; input: unknown }[]
  try {
    const res = await call(
      {
        messages: [
          { role: 'system', content: PATCH_SYSTEM },
          { role: 'user', content: patchPrompt },
        ],
        tools: [PROPOSE_EDIT_TOOL],
        maxTokens: 4000,
        temperature: 0.2,
      },
      cfg,
    )
    patchCalls = res.toolCalls
  } catch {
    return []
  }

  const edits = resolveProposedEdits(doc, patchCalls, plannedSet, primary, primaryBefore)
  if (edits.length === 0) return edits

  // 3. Self-verify.
  const demoted = await applyRelevanceJudge(
    edits,
    { before: primaryBefore, newText: primary.newText },
    doc,
    cfg,
    { callStructured: call, judge: opts.judge } as CascadeOptions,
  )
  if (demoted) {
    edits.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.from - b.from)
  }
  return edits
}

/**
 * Arm D — whole-doc free edits + a deterministic verify/repair loop. No LLM
 * judge call: numeric/figure conflicts are already deterministic-verified by
 * `deriveSeverity` inside `resolveProposedEdits` (a 'must' stays a 'must').
 * The repair step adds the OTHER deterministic signal — docGraph's own
 * refs/terms/duplicate-sentence extractors — as a check on 'probably'
 * proposals: a cited-but-not-numerically-provable claim the deterministic
 * graph does not connect to the primary block loses its confidence and caps
 * to 'optional'. This is `docGraph`'s existing deterministic extractors doing
 * double duty as the ablation's precursor to the Document Invariant Ledger.
 */
export async function runArmD(
  state: EditorState,
  primary: SuggestedEdit,
  config: LLMConfig,
  opts: AblationOptions = {},
): Promise<ProposedEdit[]> {
  const doc = state.doc
  const primaryBlockId = blockIdAtPos(doc, primary.from)
  if (!primaryBlockId) {
    console.warn('ablation arm D: primary edit has no blockId — skipping')
    return []
  }

  const cfg = effectiveConfig(config, opts.cheapModel)
  const call = opts.callStructured ?? fetchStructured
  const primaryBefore = primaryBeforeText(state, primary)

  const edits = await generateWholeDocProposals(state, primary, primaryBlockId, primaryBefore, cfg, call)
  if (edits.length === 0) return edits

  const detGraph = buildDeterministicGraph(doc)
  const hops = opts.hops ?? 2
  const neighborhood = getNeighborhood(detGraph, primaryBlockId, hops)
  for (const edit of edits) {
    if (edit.severity !== 'probably') continue // 'must' is numeric-verified; 'optional' is already the floor
    const confirmed = edit.blockId ? neighborhood.has(edit.blockId) : false
    if (!confirmed) {
      edit.severity = 'optional'
      edit.reason = `${edit.reason} (auto-review: no deterministic refs/terms link to the primary block)`
    }
  }
  edits.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.from - b.from)
  return edits
}

/**
 * Dispatch to one ablation arm by id. Arm C delegates unchanged to the
 * production `proposeCascadeEdits` (graph-scoped baseline) — `cheapModel`
 * swaps its model before the call rather than adding a new code path.
 */
export async function runAblationArm(
  armId: ArmId,
  state: EditorState,
  primary: SuggestedEdit,
  config: LLMConfig,
  opts: AblationOptions = {},
): Promise<ProposedEdit[]> {
  switch (armId) {
    case 'B':
      return runArmB(state, primary, config, opts)
    case 'D':
      return runArmD(state, primary, config, opts)
    case 'C': {
      const cfg = effectiveConfig(config, opts.cheapModel)
      return proposeCascadeEdits(state, primary, cfg, {
        callStructured: opts.callStructured,
        judge: opts.judge,
        graph: opts.graph,
      })
    }
  }
}

/** All non-cheap arms, for iterating the full B/C/D × cheap-model grid. */
export const ABLATION_ARMS: readonly ArmId[] = ['B', 'C', 'D']
