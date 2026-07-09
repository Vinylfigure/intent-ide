import { expect } from 'vitest'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'
import { blockTextRange, findBlockById } from '@/lib/prosemirror/blockIds'
import type { ProposedEdit } from '@/lib/annotations/types'
import type { StructuredRequest } from '@/lib/ai/structuredClient'

/**
 * EditPropBench-style fixtures (arXiv:2605.02083). Each item pairs a document
 * and a primary edit with sentence/block-level labels:
 * - directTargets: the primary edit's own block(s) — cascades must not touch them
 * - requiredDownstream: blocks a correct cascade MUST propose updating (recall set)
 * - protectedUnchanged: blocks no must/probably proposal may target (precision set)
 *
 * The scripted calls play the model; the real graph build, scoping, anchoring,
 * evidence verification, and severity derivation run unmodified.
 */

export interface CascadeFixture {
  name: string
  buildDoc: () => PMNode
  primaryEdit: { blockId: string; targetText: string; newText: string }
  labels: {
    directTargets: string[]
    requiredDownstream: string[]
    protectedUnchanged: string[]
  }
  scriptedCascadeCalls: Array<{ name: string; input: Record<string, unknown> }>
  /** When present, an LLM graph-extraction pass is replayed before the cascade. */
  scriptedGraphCalls?: Array<{ name: string; input: Record<string, unknown> }>
  /**
   * Scripted relevance-judge verdicts for 'must' candidates. When absent the
   * runner uses a confirm-all judge so derived musts stay musts.
   */
  scriptedJudgeCalls?: Array<{ name: string; input: Record<string, unknown> }>
  /** Simulate a dead provider: the cascade structured call throws. */
  throwOnCascade?: boolean
  /** Fixture-specific assertions beyond the shared metric checks. */
  extraAssertions?: (edits: ProposedEdit[], captured: StructuredRequest[], doc: PMNode) => void
}

export function p(blockId: string, text: string): PMNode {
  return schema.node('paragraph', { blockId }, [schema.text(text)])
}

export function h(blockId: string, level: number, text: string): PMNode {
  return schema.node('heading', { level, blockId }, [schema.text(text)])
}

export function docOf(...blocks: PMNode[]): PMNode {
  return schema.node('doc', null, blocks)
}

function propose(input: Record<string, unknown>) {
  return { name: 'propose_edit', input }
}

function link(input: Record<string, unknown>) {
  return { name: 'link_blocks', input }
}

function verdict(input: Record<string, unknown>) {
  return { name: 'verdict', input }
}

/** ~15+ pages: 70 paragraphs, ≫ the old 6000-char truncation window. */
function buildLongDoc(): PMNode {
  const blocks: PMNode[] = []
  for (let i = 1; i <= 70; i++) {
    if (i === 3) {
      blocks.push(p('b3', '"Pilot Budget" means $10,000 in total for the first procurement year.'))
    } else if (i === 60) {
      blocks.push(p('b60', 'Procurement requests may not exceed the Pilot Budget of $10,000 without board sign-off.'))
    } else {
      blocks.push(
        p(
          `b${i}`,
          `Filler paragraph number ${i} discussing entirely unrelated operational matters, office logistics, and routine scheduling details that pad this document to a realistic multi-page length.`,
        ),
      )
    }
  }
  return docOf(...blocks)
}

export const CASCADE_FIXTURES: CascadeFixture[] = [
  {
    name: 'repeated dollar figure — two cited downstream musts',
    buildDoc: () =>
      docOf(
        p('b1', '"Total Budget" means $50,000 for the pilot program.'),
        p('b2', 'Hardware purchases may consume at most half of the Total Budget of $50,000.'),
        p('b3', 'The Total Budget of $50,000 renews annually unless terminated.'),
        p('b4', 'Office snacks are restocked every other Friday.'),
      ),
    primaryEdit: { blockId: 'b1', targetText: '$50,000', newText: '$75,000' },
    labels: {
      directTargets: ['b1'],
      requiredDownstream: ['b2', 'b3'],
      protectedUnchanged: ['b4'],
    },
    scriptedCascadeCalls: [
      propose({
        block_id: 'b2',
        target_text: 'Total Budget of $50,000',
        new_text: 'Total Budget of $75,000',
        reason: 'Stale figure',
        source_block_id: 'b1',
        quoted_text: '$50,000',
        edge_type: 'contradicts',
      }),
      propose({
        block_id: 'b3',
        target_text: 'The Total Budget of $50,000',
        new_text: 'The Total Budget of $75,000',
        reason: 'Stale figure',
        source_block_id: 'b1',
        quoted_text: '$50,000',
        edge_type: 'contradicts',
      }),
    ],
    extraAssertions: (edits) => {
      expect(edits.every((e) => e.severity === 'must')).toBe(true)
    },
  },

  {
    name: 'defined-term dependency — cited but no stale token → probably',
    buildDoc: () =>
      docOf(
        p('b1', '"Retention Period" means the ninety day window after account termination.'),
        p('b2', 'All backups are purged once the Retention Period ends.'),
        p('b3', 'Support tickets close after thirty days of inactivity.'),
      ),
    primaryEdit: { blockId: 'b1', targetText: 'ninety day', newText: 'thirty day' },
    labels: {
      directTargets: ['b1'],
      requiredDownstream: ['b2'],
      protectedUnchanged: ['b3'],
    },
    scriptedCascadeCalls: [
      propose({
        block_id: 'b2',
        target_text: 'once the Retention Period ends',
        new_text: 'once the (now shorter) Retention Period ends',
        reason: 'Dependent on the definition',
        source_block_id: 'b1',
        quoted_text: 'ninety day window',
        edge_type: 'depends-on',
      }),
    ],
    extraAssertions: (edits) => {
      expect(edits[0]?.severity).toBe('probably')
    },
  },

  {
    name: 'identical sentence in two blocks — blockId picks the right occurrence',
    buildDoc: () =>
      docOf(
        p('b1', '"Service Level" means 99.9% uptime measured monthly.'),
        p('b4', 'We commit to the Service Level target of 99.9% uptime in this agreement.'),
        p('b9', 'We commit to the Service Level target of 99.9% uptime in this agreement.'),
      ),
    primaryEdit: { blockId: 'b1', targetText: '99.9% uptime', newText: '99.5% uptime' },
    labels: {
      directTargets: ['b1'],
      requiredDownstream: ['b4', 'b9'],
      protectedUnchanged: [],
    },
    scriptedCascadeCalls: [
      propose({
        block_id: 'b9',
        target_text: '99.9% uptime',
        new_text: '99.5% uptime',
        reason: 'Stale SLA figure',
        source_block_id: 'b1',
        quoted_text: '99.9% uptime',
        edge_type: 'contradicts',
      }),
      propose({
        block_id: 'b4',
        target_text: '99.9% uptime',
        new_text: '99.5% uptime',
        reason: 'Stale SLA figure',
        source_block_id: 'b1',
        quoted_text: '99.9% uptime',
        edge_type: 'contradicts',
      }),
    ],
    extraAssertions: (edits, _captured, doc) => {
      // The b9-targeted edit must land INSIDE b9 even though b4 holds the
      // identical sentence earlier in the document (plain first-occurrence
      // search would anchor both proposals into b4).
      const b9 = findBlockById(doc, 'b9')!
      const b9Edit = edits.find((e) => e.blockId === 'b9')
      expect(b9Edit).toBeDefined()
      expect(b9Edit!.from).toBeGreaterThan(b9.pos)
      expect(b9Edit!.to).toBeLessThan(b9.pos + b9.node.nodeSize)
      const b4Edit = edits.find((e) => e.blockId === 'b4')
      expect(b4Edit).toBeDefined()
      expect(b4Edit!.from).not.toBe(b9Edit!.from)
    },
  },

  {
    name: 'hallucinated citation — proposal survives but can never be must',
    buildDoc: () =>
      docOf(
        p('b1', '"Total Budget" means $50,000 for the pilot program.'),
        p('b2', 'Hardware purchases may consume at most half of the Total Budget of $50,000.'),
      ),
    primaryEdit: { blockId: 'b1', targetText: '$50,000', newText: '$75,000' },
    labels: {
      directTargets: ['b1'],
      requiredDownstream: [],
      protectedUnchanged: [],
    },
    scriptedCascadeCalls: [
      propose({
        block_id: 'b2',
        target_text: 'Total Budget of $50,000',
        new_text: 'Total Budget of $75,000',
        reason: 'Stale figure',
        source_block_id: 'b1',
        quoted_text: 'the pilot costs a quarter million dollars', // fabricated
        edge_type: 'contradicts',
      }),
    ],
    extraAssertions: (edits) => {
      expect(edits).toHaveLength(1)
      expect(edits[0].severity).toBe('optional')
      expect(edits[0].evidence).toBeNull()
    },
  },

  {
    name: 'unanchorable proposal — hallucinated block and text is dropped',
    buildDoc: () =>
      docOf(
        p('b1', '"Total Budget" means $50,000 for the pilot program.'),
        p('b2', 'Hardware purchases may consume at most half of the Total Budget.'),
      ),
    primaryEdit: { blockId: 'b1', targetText: '$50,000', newText: '$75,000' },
    labels: {
      directTargets: ['b1'],
      requiredDownstream: [],
      protectedUnchanged: ['b2'],
    },
    scriptedCascadeCalls: [
      propose({
        block_id: 'ghost',
        target_text: 'a sentence that exists nowhere in this document',
        new_text: 'anything',
        reason: 'Hallucinated region',
      }),
    ],
    extraAssertions: (edits) => {
      expect(edits).toEqual([])
    },
  },

  {
    name: 'proposal overlapping the primary region is dropped',
    buildDoc: () =>
      docOf(
        p('b1', '"Total Budget" means $50,000 for the pilot program.'),
        p('b2', 'Hardware purchases may consume at most half of the Total Budget.'),
      ),
    primaryEdit: { blockId: 'b1', targetText: '$50,000', newText: '$75,000' },
    labels: {
      directTargets: ['b1'],
      requiredDownstream: [],
      protectedUnchanged: [],
    },
    scriptedCascadeCalls: [
      propose({
        block_id: 'b1',
        target_text: '$50,000',
        new_text: '$75,000',
        reason: 'Double-editing the primary region',
      }),
    ],
    extraAssertions: (edits) => {
      expect(edits).toEqual([])
    },
  },

  {
    name: 'long document — cascade reaches block 60, far past the old 6000-char window',
    buildDoc: buildLongDoc,
    primaryEdit: { blockId: 'b3', targetText: '$10,000', newText: '$25,000' },
    labels: {
      directTargets: ['b3'],
      requiredDownstream: ['b60'],
      protectedUnchanged: ['b45', 'b70'],
    },
    scriptedCascadeCalls: [
      propose({
        block_id: 'b60',
        target_text: 'Pilot Budget of $10,000',
        new_text: 'Pilot Budget of $25,000',
        reason: 'Stale figure far downstream',
        source_block_id: 'b3',
        quoted_text: '$10,000',
        edge_type: 'contradicts',
      }),
    ],
    extraAssertions: (edits, captured, doc) => {
      // b60 physically sits beyond the old truncation horizon.
      const b60 = findBlockById(doc, 'b60')!
      expect(doc.textBetween(0, b60.pos, '\n').length).toBeGreaterThan(6000)
      // The graph-scoped payload SENT b60 to the model...
      const prompt = captured
        .flatMap((r) => r.messages)
        .map((m) => m.content)
        .join('\n')
      expect(prompt).toContain('[b60]')
      expect(prompt).toContain('board sign-off')
      // ...but not unconnected filler blocks (scoping, not just de-truncation).
      expect(prompt).not.toContain('[b45]')
      expect(prompt).not.toContain('Filler paragraph number 45')
      expect(edits[0]?.severity).toBe('must')
    },
  },

  {
    name: 'LLM-extracted contradicts edge feeds the neighborhood',
    buildDoc: () =>
      docOf(
        p('b1', 'Our latency target is a hard 100ms p99 for all read paths.'),
        p('b2', 'Read requests are considered healthy whenever they complete inside a tenth of a second.'),
        p('b3', 'The cafeteria menu rotates on Mondays.'),
      ),
    // No shared term, no cross-reference — only the scripted link_blocks pass
    // connects b2 to b1 (semantic paraphrase a regex can never catch).
    primaryEdit: { blockId: 'b1', targetText: '100ms p99', newText: '250ms p99' },
    labels: {
      directTargets: ['b1'],
      requiredDownstream: ['b2'],
      protectedUnchanged: ['b3'],
    },
    scriptedGraphCalls: [
      link({
        from_block_id: 'b2',
        to_block_id: 'b1',
        edge_type: 'depends-on',
        quoted_text: 'inside a tenth of a second',
      }),
    ],
    scriptedCascadeCalls: [
      propose({
        block_id: 'b2',
        target_text: 'inside a tenth of a second',
        new_text: 'inside a quarter of a second',
        reason: 'Paraphrased latency threshold is now stale',
        source_block_id: 'b1',
        quoted_text: '100ms p99',
        edge_type: 'contradicts',
      }),
    ],
    extraAssertions: (edits) => {
      expect(edits).toHaveLength(1)
      expect(edits[0].evidence?.edgeType).toBe('contradicts')
    },
  },

  {
    name: 'uncited cosmetic rewrite of a protected neighbor stays optional',
    buildDoc: () =>
      docOf(
        p('b1', '"Total Budget" means $50,000 for the pilot program.'),
        p('b2', 'Reports about the Total Budget are filed quarterly by the finance team.'),
      ),
    primaryEdit: { blockId: 'b1', targetText: '$50,000', newText: '$75,000' },
    labels: {
      directTargets: ['b1'],
      requiredDownstream: [],
      protectedUnchanged: ['b2'], // no must/probably may touch it
    },
    scriptedCascadeCalls: [
      propose({
        block_id: 'b2',
        target_text: 'filed quarterly by the finance team',
        new_text: 'filed every quarter by Finance',
        reason: 'Reads better', // no citation at all
      }),
    ],
    extraAssertions: (edits) => {
      expect(edits).toHaveLength(1)
      expect(edits[0].severity).toBe('optional')
    },
  },

  {
    name: 'judge demotes irrelevant citation — string-match must is not meaning-match must',
    buildDoc: () =>
      docOf(
        p('b1', '"Total Budget" means $50,000 for the pilot program, as noted in the appendix.'),
        p('b2', 'Historical note: the 2019 office renovation also cost $50,000, unrelated to the Total Budget.'),
      ),
    primaryEdit: { blockId: 'b1', targetText: '$50,000', newText: '$75,000' },
    labels: {
      directTargets: ['b1'],
      requiredDownstream: [],
      protectedUnchanged: [],
    },
    scriptedCascadeCalls: [
      propose({
        block_id: 'b2',
        target_text: 'also cost $50,000',
        new_text: 'also cost $75,000',
        reason: 'Stale figure',
        // Real text from b1 — verifies verbatim — but says nothing about b2's figure.
        source_block_id: 'b1',
        quoted_text: 'as noted in the appendix',
        edge_type: 'references',
      }),
    ],
    // hasVerbatimConflict sees the shared "$50,000" and derives 'must'; the
    // judge recognizes the renovation cost is a coincidental figure and denies.
    scriptedJudgeCalls: [
      verdict({
        index: 1,
        genuinely_conflicts: false,
        reason: 'the $50,000 in this block is a 2019 renovation cost, not the Total Budget',
      }),
    ],
    extraAssertions: (edits) => {
      expect(edits).toHaveLength(1)
      expect(edits[0].severity).toBe('probably')
      expect(edits[0].reason).toContain('(auto-review:')
      expect(edits[0].evidence).not.toBeNull() // citation kept, confidence lowered
    },
  },

  {
    name: 'provider failure — cascade degrades to primary-only, never throws',
    buildDoc: () =>
      docOf(
        p('b1', '"Total Budget" means $50,000 for the pilot program.'),
        p('b2', 'Hardware purchases may consume at most half of the Total Budget of $50,000.'),
      ),
    primaryEdit: { blockId: 'b1', targetText: '$50,000', newText: '$75,000' },
    labels: {
      directTargets: ['b1'],
      requiredDownstream: [],
      protectedUnchanged: ['b2'],
    },
    scriptedCascadeCalls: [],
    throwOnCascade: true,
    extraAssertions: (edits) => {
      expect(edits).toEqual([])
    },
  },
]

/** Resolve a fixture's primary edit against its built doc. */
export function resolvePrimary(doc: PMNode, fixture: CascadeFixture) {
  const range = blockTextRange(doc, fixture.primaryEdit.blockId, fixture.primaryEdit.targetText)
  if (!range) {
    throw new Error(
      `fixture "${fixture.name}": primary target "${fixture.primaryEdit.targetText}" not found in ${fixture.primaryEdit.blockId}`,
    )
  }
  return {
    from: range.from,
    to: range.to,
    newText: fixture.primaryEdit.newText,
    reason: 'bench primary edit',
  }
}
