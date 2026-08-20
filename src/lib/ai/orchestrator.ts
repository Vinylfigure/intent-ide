import type { EditorState } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import type {
  CascadeEdgeType,
  CascadeEvidence,
  CascadeSeverity,
  ProposedEdit,
  SuggestedEdit,
} from '@/lib/annotations/types'
import { SEVERITY_ORDER } from '@/lib/annotations/types'
import type { LLMConfig } from '@/stores/settingsStore'
import { findTextInDoc } from '@/lib/prosemirror/applyProposedEdits'
import {
  blockIdAtPos,
  blockTextRange,
  findBlockById,
  INSERTION_CONTEXT_RADIUS,
} from '@/lib/prosemirror/blockIds'
import { containsTerm, getDocGraph, getNeighborhood, type DocGraph } from '@/lib/graphrag/docGraph'
import { fetchStructured, type CallStructuredFn } from '@/lib/ai/structuredClient'
import { judgeMustCandidates, type JudgeFn } from '@/lib/ai/relevanceJudge'

/**
 * Graph-scoped cascade: instead of one whole-doc LLM pass (previously
 * truncated to 6000 chars — a 20-page document never cascaded past page 4),
 * the primary edit's block is resolved in the document dependency graph and
 * only its bounded N-hop neighborhood is sent to the model. Returned edits are
 * anchored by blockId first (disambiguating repeated phrases), evidence is
 * verified verbatim against the live doc, and severity is DERIVED from graph
 * structure + conflict checks — never trusted from the model. A proposal the
 * model cannot ground in a locatable citation is a lead, not a must.
 */

const EDGE_TYPES: ReadonlySet<string> = new Set([
  'defines',
  'references',
  'depends-on',
  'implements',
  'tests',
  'contradicts',
  'duplicates',
])

export const PROPOSE_EDIT_TOOL = {
  name: 'propose_edit',
  description:
    'Propose a change to one of the listed blocks that becomes inconsistent because of the primary edit. Call once per distinct affected block. Only propose edits where a figure, claim, name, or statement must be brought into agreement with the primary edit.',
  input_schema: {
    type: 'object',
    properties: {
      block_id: {
        type: 'string',
        description: 'Id of the listed block that contains target_text.',
      },
      target_text: {
        type: 'string',
        description:
          'The exact existing text to replace, copied verbatim from that block.',
      },
      new_text: { type: 'string', description: 'The replacement text for that region.' },
      reason: { type: 'string', description: 'Why this region must change given the primary edit.' },
      source_block_id: {
        type: 'string',
        description:
          'Id of the block whose content evidences WHY this must change (usually the primary block).',
      },
      quoted_text: {
        type: 'string',
        description: 'Verbatim quote from the source block that conflicts with the target.',
      },
      edge_type: {
        type: 'string',
        enum: ['defines', 'references', 'depends-on', 'implements', 'tests', 'contradicts', 'duplicates'],
        description: 'The relationship linking the cited block to the edit.',
      },
    },
    required: ['block_id', 'target_text', 'new_text', 'reason'],
  },
}

const CASCADE_SYSTEM =
  'You keep a document internally consistent. You are given a primary edit and a set of document blocks, each listed as [blockId] text — optionally with a (§ Heading › Subheading) prefix locating the block in the document outline. Find blocks that become inconsistent, outdated, or contradictory because of the primary edit and call propose_edit once for each. Only edit listed blocks; reference them by their block_id. Copy target_text verbatim from the block. Never propose an edit to the primary block itself. Cite your evidence: source_block_id plus a verbatim quoted_text showing the conflict. If nothing needs to change, call nothing.'

function newId(): string {
  try {
    return `pe_${crypto.randomUUID()}`
  } catch {
    return `pe_${Math.random().toString(36).slice(2)}`
  }
}

/**
 * Verbatim before/after snippet around a pure-insertion point, for apply-time
 * drift validation (see applyProposedEdits.ts) — insertions have no target
 * text to fingerprint, so this is the only signal that the surrounding
 * document still looks like it did when the insertion was proposed.
 *
 * `beforeSpan`/`afterSpan` record the actual POSITION distance each snippet
 * was captured over (== INSERTION_CONTEXT_RADIUS, unless clamped by a nearby
 * doc boundary at capture time). Apply-time validation re-derives its window
 * from these recorded spans, not from a fresh `doc.content.size` clamp —
 * otherwise an edit anywhere else in the document that changes the doc's
 * total size (even far from `pos`) would grow or shrink the live window
 * relative to what was captured and produce a spurious mismatch.
 */
export function captureInsertionContext(
  doc: PMNode,
  pos: number,
): { before: string; after: string; beforeSpan: number; afterSpan: number } {
  const from = Math.max(0, pos - INSERTION_CONTEXT_RADIUS)
  const to = Math.min(doc.content.size, pos + INSERTION_CONTEXT_RADIUS)
  return {
    before: doc.textBetween(from, pos),
    after: doc.textBetween(pos, to),
    beforeSpan: pos - from,
    afterSpan: to - pos,
  }
}

/**
 * Build the primary ProposedEdit from the resolving agent's suggested edit.
 * `doc` is only needed for pure insertions (from === to, targetText === '')
 * to capture apply-time drift-validation context; omit it for replacements.
 */
export function primaryProposedEdit(
  edit: SuggestedEdit,
  targetText: string,
  blockId?: string,
  doc?: PMNode,
): ProposedEdit {
  const isInsertion = edit.from === edit.to && targetText === ''
  return {
    id: newId(),
    from: edit.from,
    to: edit.to,
    newText: edit.newText,
    reason: edit.reason,
    relation: 'primary',
    status: 'pending',
    targetText,
    ...(blockId ? { blockId } : {}),
    ...(isInsertion && doc ? { insertionContext: captureInsertionContext(doc, edit.from) } : {}),
    // The primary edit is the user's own intent — always 'must', self-evidencing.
    severity: 'must',
    evidence: null,
  }
}

interface ToolCallInput {
  block_id?: string
  target_text?: string
  new_text?: string
  reason?: string
  source_block_id?: string
  quoted_text?: string
  edge_type?: string
}

// Function words that vanish in any full-sentence rewrite; treating them as
// "changed content" would inflate every rewrite into a 'must' conflict.
const CONFLICT_STOPWORDS = new Set([
  'this', 'that', 'these', 'those', 'with', 'without', 'from', 'into', 'onto',
  'have', 'been', 'were', 'will', 'would', 'shall', 'should', 'could', 'must',
  'they', 'their', 'them', 'there', 'here', 'when', 'where', 'which', 'while',
  'what', 'whose', 'than', 'then', 'also', 'only', 'some', 'such', 'each',
  'more', 'most', 'other', 'over', 'under', 'after', 'before', 'about',
  'because', 'therefore', 'however', 'shown', 'given', 'upon', 'both', 'very',
])

/**
 * Tokens whose meaning changed in the primary edit: numbers/figures, quoted
 * phrases, and substantive (non-stopword) words present before but gone after.
 * These are what a stale downstream block would still contain. Exported for tests.
 */
export function extractChangedTokens(before: string, after: string): string[] {
  const lowerAfter = after.toLowerCase()
  const tokens = new Set<string>()

  for (const m of before.matchAll(/[$€£]?\d(?:[\d,.]*\d)?%?/g)) {
    // Bare single digits cross-fire ("Section 3" vs any "3") — need 2+ chars.
    if (m[0].length < 2) continue
    if (!lowerAfter.includes(m[0].toLowerCase())) tokens.add(m[0])
  }
  for (const m of before.matchAll(/["“']([^"“”'\n]{3,60})["”']/g)) {
    if (!lowerAfter.includes(m[1].toLowerCase())) tokens.add(m[1])
  }
  for (const m of before.matchAll(/[A-Za-z][\w-]{3,}/g)) {
    if (CONFLICT_STOPWORDS.has(m[0].toLowerCase())) continue
    if (!containsTerm(after, m[0])) tokens.add(m[0])
  }
  return [...tokens]
}

/**
 * True when the target block still verbatim-contains content the primary edit
 * removed or changed — a provable contradiction, hence 'must'.
 */
export function hasVerbatimConflict(
  targetBlockText: string,
  primaryBefore: string,
  primaryNew: string,
): boolean {
  const trimmed = primaryBefore.trim()
  if (trimmed.length >= 8 && targetBlockText.toLowerCase().includes(trimmed.toLowerCase())) {
    return true
  }
  return extractChangedTokens(primaryBefore, primaryNew).some((token) =>
    containsTerm(targetBlockText, token),
  )
}

/**
 * Severity is derived, never trusted from the model:
 * - no locatable citation → 'optional' (a lead, not a must)
 * - cited + verbatim conflict in the target block → 'must'
 * - cited via a graph edge, no verbatim proof → 'probably'
 */
export function deriveSeverity(
  evidence: CascadeEvidence | null,
  targetBlockText: string,
  primaryBefore: string,
  primaryNew: string,
): CascadeSeverity {
  if (!evidence) return 'optional'
  if (hasVerbatimConflict(targetBlockText, primaryBefore, primaryNew)) return 'must'
  return 'probably'
}

function buildEvidence(
  doc: PMNode,
  input: ToolCallInput,
): CascadeEvidence | null {
  const sourceBlockId = input.source_block_id
  const quotedText = input.quoted_text?.trim()
  if (!sourceBlockId || !quotedText) return null
  if (!blockTextRange(doc, sourceBlockId, quotedText)) return null
  const edgeType: CascadeEdgeType = EDGE_TYPES.has(input.edge_type ?? '')
    ? (input.edge_type as CascadeEdgeType)
    : 'references'
  return { sourceBlockId, quotedText, edgeType }
}

export interface CascadeOptions {
  callStructured?: CallStructuredFn
  /** Pre-built graph (tests / warm callers); defaults to the cached getDocGraph. */
  graph?: DocGraph
  /** Graph traversal radius. */
  hops?: number
  /** Cap on candidate blocks sent to the model (block COUNT — text is never truncated). */
  maxBlocks?: number
  /** Relevance judge for 'must' candidates; defaults to judgeMustCandidates over callStructured. */
  judge?: JudgeFn
  /**
   * Test/caller override for the settings-store citation-verification toggle.
   * When false the judge stage is skipped entirely — severities stay derived.
   */
  judgeEnabled?: boolean
  /**
   * Text the primary range held BEFORE the edit. Callers whose primary edit is
   * ALREADY APPLIED (direct-edit cascade trigger) must pass this: for them the
   * live doc at primary.from..to holds the NEW text, so reading "before" from
   * the doc would invert the prompt's Was:/Now: lines AND break verbatim-
   * conflict severity derivation (before === after ⇒ no changed tokens ⇒ a
   * provable contradiction downgrades to 'probably'). When omitted, the live
   * doc text at the primary range is the before text (un-applied edits —
   * the default resolver path, byte-identical to prior behavior).
   */
  primaryBefore?: string
}

/** User toggle for the citation-verification judge (settings store, default true). */
async function judgeEnabledFromStore(): Promise<boolean> {
  try {
    const { useSettingsStore } = await import('@/stores/settingsStore')
    return useSettingsStore.getState().judgeEnabled
  } catch {
    return true
  }
}

/**
 * Second-pass gate on 'must': a batched judge call re-examines each cited
 * conflict and demotes candidates it cannot confirm to 'probably', appending
 * the judge's reason. Runs only when at least one must exists. Best-effort —
 * a judge failure keeps the derived severities unchanged, never blocks.
 * Mutates the edits in place; returns true when any severity changed.
 */
/**
 * Parse `propose_edit` tool calls into anchored, evidence-verified,
 * severity-derived ProposedEdits. Pure with respect to the model: shared by
 * every cascade mechanism that generates candidates via the propose_edit tool
 * (the graph-scoped pipeline below, and the whole-doc ablation arms in
 * `ablationArms.ts`) so anchoring/evidence/severity rules — the substrate the
 * ablation holds constant — stay byte-identical across arms; only candidate
 * SCOPING and the verify stage differ between them.
 */
export function resolveProposedEdits(
  doc: PMNode,
  toolCalls: { name: string; input: unknown }[],
  scope: ReadonlySet<string>,
  primary: { from: number; to: number; newText: string },
  primaryBefore: string,
): ProposedEdit[] {
  const edits: ProposedEdit[] = []
  for (const call of toolCalls) {
    if (call.name !== 'propose_edit') continue
    const input = call.input as ToolCallInput
    const targetText = input?.target_text?.trim()
    const newText = input?.new_text
    if (!targetText || newText === undefined) continue

    // Anchor by blockId first; fall back to first-occurrence only when the
    // block can't be located, then re-derive which block we actually landed in.
    let located = input.block_id ? blockTextRange(doc, input.block_id, targetText) : null
    let resolvedBlockId = located ? input.block_id! : null
    if (!located) {
      located = findTextInDoc(doc, targetText)
      if (located) resolvedBlockId = blockIdAtPos(doc, located.from)
    }
    if (!located || !resolvedBlockId) continue // unanchorable — drop rather than guess

    // Scope gate: the edit must land inside the candidate set we sent.
    if (!scope.has(resolvedBlockId)) continue
    // Skip anything overlapping the primary range to avoid double-editing it.
    if (located.from < primary.to && located.to > primary.from) continue
    // Duplicate gate: repeated tool calls anchor to the same range (blockTextRange
    // returns the first occurrence), and applying two replacements over one region
    // in a single transaction corrupts the text — first proposal wins.
    const anchored = located
    if (edits.some((e) => anchored.from < e.to && anchored.to > e.from)) continue

    const targetBlockText = findBlockById(doc, resolvedBlockId)?.node.textContent ?? ''
    const evidence = buildEvidence(doc, input)
    const severity = deriveSeverity(evidence, targetBlockText, primaryBefore, primary.newText)

    edits.push({
      id: newId(),
      from: located.from,
      to: located.to,
      newText,
      reason: input?.reason ?? 'Consistency with the primary edit.',
      relation: 'cascade',
      status: 'pending',
      targetText,
      blockId: resolvedBlockId,
      severity,
      evidence,
    })
  }

  edits.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.from - b.from)
  return edits
}

export async function applyRelevanceJudge(
  edits: ProposedEdit[],
  primary: { before: string; newText: string },
  doc: EditorState['doc'],
  config: LLMConfig,
  opts: CascadeOptions,
): Promise<boolean> {
  const musts = edits.filter((e) => e.severity === 'must' && e.evidence !== null)
  if (musts.length === 0) return false

  const judge: JudgeFn =
    opts.judge ??
    ((candidates, prim, d, cfg) =>
      judgeMustCandidates(candidates, prim, d, cfg, opts.callStructured ?? fetchStructured))

  let verdicts: Awaited<ReturnType<JudgeFn>>
  try {
    verdicts = await judge(musts, primary, doc, config)
  } catch {
    return false // judge down — keep derived severities
  }
  // Zero verdicts for a non-empty candidate set is a judge malfunction, not
  // an all-deny (the judge contract yields one verdict per candidate or
  // throws). Treat it like a failed call: keep derived severities.
  if (verdicts.size === 0) return false

  let demoted = false
  musts.forEach((edit, i) => {
    const verdict = verdicts.get(i)
    if (verdict?.genuinelyConflicts) return
    edit.severity = 'probably'
    edit.reason = `${edit.reason} (auto-review: ${verdict?.reason ?? 'no verdict returned'})`
    demoted = true
  })
  return demoted
}

/**
 * Ask the model for cascade edits over the primary edit's graph neighborhood
 * and anchor each proposal to live document positions. Returns only edits that
 * could be located, sit inside the sent neighborhood, and don't overlap the
 * primary range — sorted by derived severity. Best-effort: any failure
 * returns [] so resolution is never blocked.
 */
export async function proposeCascadeEdits(
  state: EditorState,
  primary: SuggestedEdit,
  config: LLMConfig,
  opts: CascadeOptions = {},
): Promise<ProposedEdit[]> {
  const doc = state.doc
  const primaryBlockId = blockIdAtPos(doc, primary.from)
  if (!primaryBlockId) {
    console.warn('cascade: primary edit has no blockId — skipping cascade')
    return []
  }

  let graph: DocGraph
  try {
    graph =
      opts.graph ??
      (await getDocGraph(doc, config, { callStructured: opts.callStructured }))
  } catch {
    return []
  }

  const hops = opts.hops ?? 2
  const maxBlocks = opts.maxBlocks ?? 24
  const neighborhood = getNeighborhood(graph, primaryBlockId, hops)
  // Nothing connected to the primary block → nothing can cascade (precision-first).
  if (neighborhood.size <= 1) return []

  // Re-resolve every candidate against the LIVE doc; graph positions are
  // build-time snapshots and are never trusted for content.
  const candidates: Array<{
    blockId: string
    hop: number
    sourceRank: number
    pos: number
    text: string
  }> = []
  for (const [blockId, { hop, sourceRank }] of neighborhood) {
    const live = findBlockById(doc, blockId)
    if (!live) continue // block vanished since graph build
    candidates.push({ blockId, hop, sourceRank, pos: live.pos, text: live.node.textContent })
  }
  // Source-aware ordering: at the same hop, blocks connected via
  // higher-precision edges (deterministic/llm/embedding) outrank graphiti
  // co-mentions, so the maxBlocks slice sheds low-precision candidates first.
  candidates.sort((a, b) => a.hop - b.hop || a.sourceRank - b.sourceRank || a.pos - b.pos)
  if (candidates.length > maxBlocks) {
    // Never a silent truncation — counts only, no document text.
    console.warn(
      `cascade: neighborhood truncated — sending ${maxBlocks} of ${candidates.length} candidate blocks`,
    )
  }
  const sent = candidates.slice(0, maxBlocks)
  const sentIds = new Set(sent.map((c) => c.blockId))

  const primaryBefore =
    opts.primaryBefore ??
    doc.textBetween(
      Math.min(primary.from, doc.content.size),
      Math.min(primary.to, doc.content.size),
    )

  const userPrompt = [
    `PRIMARY EDIT (in block [${primaryBlockId}], just applied or about to apply):`,
    `- Was: "${primaryBefore}"`,
    `- Now: "${primary.newText}"`,
    '',
    'CANDIDATE BLOCKS (the only blocks you may edit):',
    // Heading context comes from the graph node (build-time outline snapshot);
    // block TEXT is always the live-doc resolve above, never the snapshot.
    ...sent.map((c) => {
      const headingPath = graph.nodes.get(c.blockId)?.headingPath ?? []
      return headingPath.length
        ? `[${c.blockId}] (§ ${headingPath.join(' › ')}) ${c.text}`
        : `[${c.blockId}] ${c.text}`
    }),
  ].join('\n')

  let toolCalls: { name: string; input: unknown }[]
  try {
    const res = await (opts.callStructured ?? fetchStructured)(
      {
        messages: [
          { role: 'system', content: CASCADE_SYSTEM },
          { role: 'user', content: userPrompt },
        ],
        tools: [PROPOSE_EDIT_TOOL],
        maxTokens: 2000,
        temperature: 0.2,
      },
      config,
    )
    toolCalls = res.toolCalls
  } catch {
    return []
  }

  const edits = resolveProposedEdits(doc, toolCalls, sentIds, primary, primaryBefore)

  // User toggle ("Verify must-severity citations"): when off, skip the judge
  // entirely — severities stay derived from graph structure + conflict checks.
  const judgeOn = opts.judgeEnabled ?? (await judgeEnabledFromStore())
  if (!judgeOn) return edits

  const demoted = await applyRelevanceJudge(
    edits,
    { before: primaryBefore, newText: primary.newText },
    doc,
    config,
    opts,
  )
  if (demoted) {
    edits.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.from - b.from)
  }
  return edits
}

/** Assemble the full edit set for a resolution: primary first, then cascades. */
export function assembleResolutionEdits(
  primary: ProposedEdit,
  cascades: ProposedEdit[],
): ProposedEdit[] {
  return [primary, ...cascades]
}
