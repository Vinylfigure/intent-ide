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
 * pipeline (arm C) uses. Arms differ only in what candidates they generate
 * from — whole document (B, D) vs 2-hop graph neighborhood (C) — and what
 * "verify" pass runs after generation. That isolates the variable the
 * ablation is actually testing (scoping mechanism) instead of also varying
 * the anchoring/evidence substrate, which would confound the comparison.
 */

export type ArmId = 'B' | 'C' | 'D'

export interface AblationOptions {
  callStructured?: CallStructuredFn
  /** Arm B's self-verify judge override (defaults like the production judge). */
  judge?: JudgeFn
  /** Pre-built graph — arm C only (passed through to proposeCascadeEdits). */
  graph?: DocGraph
  /** Route generation (and, for B, self-verify) through pickUtilityModel — arm E. */
  cheapModel?: boolean
  /** Deterministic-graph connectivity radius for arm D's repair step. */
  hops?: number
}

const WHOLE_DOC_SYSTEM =
  'You keep a document internally consistent. You are given a primary edit and the FULL document, each block listed as [blockId] text. Find blocks that become inconsistent, outdated, or contradictory because of the primary edit and call propose_edit once for each. Only edit listed blocks; reference them by their block_id. Copy target_text verbatim from the block. Never propose an edit to the primary block itself. Cite your evidence: source_block_id plus a verbatim quoted_text showing the conflict. If nothing needs to change, call nothing.'

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
 * the "whole doc" half of arms B and D. Best-effort: any transport failure
 * degrades to zero proposals, same contract as the graph-scoped pipeline.
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
 * Arm B — whole-doc plan-then-patch + self-verify. The "plan" (which blocks
 * are affected) and "patch" (what they become) collapse into one generation
 * call — a scripted model already knows its answer, so a separate plan call
 * would only add a second scripted round-trip without changing pipeline
 * behavior. The self-verify pass is real: the same LLM judge arm C uses
 * re-examines every derived 'must' and demotes unconfirmed ones.
 */
export async function runArmB(
  state: EditorState,
  primary: SuggestedEdit,
  config: LLMConfig,
  opts: AblationOptions = {},
): Promise<ProposedEdit[]> {
  const doc = state.doc
  const primaryBlockId = blockIdAtPos(doc, primary.from)
  if (!primaryBlockId) return []

  const cfg = effectiveConfig(config, opts.cheapModel)
  const call = opts.callStructured ?? fetchStructured
  const primaryBefore = primaryBeforeText(state, primary)

  const edits = await generateWholeDocProposals(state, primary, primaryBlockId, primaryBefore, cfg, call)
  if (edits.length === 0) return edits

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
  if (!primaryBlockId) return []

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
