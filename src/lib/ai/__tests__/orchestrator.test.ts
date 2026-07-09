import { describe, it, expect, beforeEach } from 'vitest'
import { EditorState } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'
import { blockTextRange, findBlockById } from '@/lib/prosemirror/blockIds'
import { buildDeterministicGraph, invalidateDocGraphCache } from '@/lib/graphrag/docGraph'
import type { CallStructuredFn, StructuredRequest } from '@/lib/ai/structuredClient'
import type { LLMConfig } from '@/stores/settingsStore'
import type { SuggestedEdit } from '@/lib/annotations/types'
import {
  proposeCascadeEdits,
  primaryProposedEdit,
  extractChangedTokens,
  hasVerbatimConflict,
  deriveSeverity,
} from '../orchestrator'

const CONFIG: LLMConfig = { provider: 'claude', apiKey: 'test-key', model: 'test-model' }

function p(blockId: string | null, text: string): PMNode {
  return schema.node('paragraph', { blockId }, [schema.text(text)])
}

function docOf(...blocks: PMNode[]): PMNode {
  return schema.node('doc', null, blocks)
}

function stateOf(doc: PMNode): EditorState {
  return EditorState.create({ schema, doc })
}

function scripted(
  calls: Array<{ name: string; input: Record<string, unknown> }>,
  capture?: StructuredRequest[],
): CallStructuredFn {
  return async (req) => {
    capture?.push(req)
    return { toolCalls: calls }
  }
}

/** Primary edit replacing `phrase` inside block `blockId`. */
function primaryEditFor(doc: PMNode, blockId: string, phrase: string, newText: string): SuggestedEdit {
  const range = blockTextRange(doc, blockId, phrase)
  if (!range) throw new Error(`fixture bug: "${phrase}" not in ${blockId}`)
  return { from: range.from, to: range.to, newText, reason: 'test primary' }
}

// Shared fixture: b1 defines "Launch Date"; b2/b3 reference it (graph edges);
// far is completely unconnected.
const FIXTURE_DOC = docOf(
  p('b1', '"Launch Date" means March 1, 2026.'),
  p('b2', 'The beta program ends on March 1, 2026, just before the Launch Date.'),
  p('b3', 'Marketing emails go out two weeks ahead of the Launch Date.'),
  p('far', 'Unrelated appendix content about office plants and watering schedules.'),
)

beforeEach(() => {
  invalidateDocGraphCache()
})

describe('proposeCascadeEdits — scoping', () => {
  it('sends only the graph neighborhood, never unconnected blocks', async () => {
    const state = stateOf(FIXTURE_DOC)
    const primary = primaryEditFor(FIXTURE_DOC, 'b1', 'March 1, 2026', 'June 1, 2026')
    const captured: StructuredRequest[] = []
    await proposeCascadeEdits(state, primary, CONFIG, {
      graph: buildDeterministicGraph(FIXTURE_DOC),
      callStructured: scripted([], captured),
    })
    expect(captured).toHaveLength(1)
    const prompt = captured[0].messages.map((m) => m.content).join('\n')
    expect(prompt).toContain('[b2]')
    expect(prompt).toContain('[b3]')
    expect(prompt).not.toContain('office plants')
    expect(prompt).not.toContain('[far]')
  })

  it('returns [] without calling the model when the primary block is unstamped', async () => {
    const unstamped = docOf(p(null, 'no ids here at all'))
    const state = stateOf(unstamped)
    let called = false
    const edits = await proposeCascadeEdits(
      state,
      { from: 2, to: 6, newText: 'x', reason: 'r' },
      CONFIG,
      {
        graph: buildDeterministicGraph(unstamped),
        callStructured: async () => {
          called = true
          return { toolCalls: [] }
        },
      },
    )
    expect(edits).toEqual([])
    expect(called).toBe(false)
  })

  it('returns [] when the primary block has no graph neighbors (precision-first)', async () => {
    const isolated = docOf(p('a', 'alone in the world'), p('b', 'also alone'))
    const state = stateOf(isolated)
    let called = false
    const edits = await proposeCascadeEdits(
      state,
      primaryEditFor(isolated, 'a', 'alone', 'together'),
      CONFIG,
      {
        graph: buildDeterministicGraph(isolated),
        callStructured: async () => {
          called = true
          return { toolCalls: [] }
        },
      },
    )
    expect(edits).toEqual([])
    expect(called).toBe(false)
  })

  it('returns [] when the structured call throws (best-effort contract)', async () => {
    const state = stateOf(FIXTURE_DOC)
    const primary = primaryEditFor(FIXTURE_DOC, 'b1', 'March 1, 2026', 'June 1, 2026')
    const edits = await proposeCascadeEdits(state, primary, CONFIG, {
      graph: buildDeterministicGraph(FIXTURE_DOC),
      callStructured: async () => {
        throw new Error('boom')
      },
    })
    expect(edits).toEqual([])
  })
})

describe('proposeCascadeEdits — anchoring', () => {
  it('anchors by blockId, landing in the requested block even when the phrase repeats earlier', async () => {
    // "ahead of the Launch Date" appears only in b3, but "the Launch Date"
    // appears in b1, b2, and b3 — target the b3 occurrence explicitly.
    const state = stateOf(FIXTURE_DOC)
    const primary = primaryEditFor(FIXTURE_DOC, 'b1', 'March 1, 2026', 'June 1, 2026')
    const edits = await proposeCascadeEdits(state, primary, CONFIG, {
      graph: buildDeterministicGraph(FIXTURE_DOC),
      callStructured: scripted([
        {
          name: 'propose_edit',
          input: {
            block_id: 'b3',
            target_text: 'the Launch Date',
            new_text: 'the new Launch Date',
            reason: 'test',
          },
        },
      ]),
    })
    expect(edits).toHaveLength(1)
    expect(edits[0].blockId).toBe('b3')
    const b3 = findBlockById(state.doc, 'b3')!
    expect(edits[0].from).toBeGreaterThan(b3.pos)
    expect(edits[0].to).toBeLessThan(b3.pos + b3.node.nodeSize)
  })

  it('falls back to document-wide search when block_id is bogus, re-deriving the real block', async () => {
    const state = stateOf(FIXTURE_DOC)
    const primary = primaryEditFor(FIXTURE_DOC, 'b1', 'March 1, 2026', 'June 1, 2026')
    const edits = await proposeCascadeEdits(state, primary, CONFIG, {
      graph: buildDeterministicGraph(FIXTURE_DOC),
      callStructured: scripted([
        {
          name: 'propose_edit',
          input: {
            block_id: 'ghost-block',
            target_text: 'Marketing emails go out',
            new_text: 'Marketing emails will go out',
            reason: 'test',
          },
        },
      ]),
    })
    expect(edits).toHaveLength(1)
    expect(edits[0].blockId).toBe('b3')
  })

  it('drops fallback anchors that land outside the sent neighborhood (scope gate)', async () => {
    const state = stateOf(FIXTURE_DOC)
    const primary = primaryEditFor(FIXTURE_DOC, 'b1', 'March 1, 2026', 'June 1, 2026')
    const edits = await proposeCascadeEdits(state, primary, CONFIG, {
      graph: buildDeterministicGraph(FIXTURE_DOC),
      callStructured: scripted([
        {
          name: 'propose_edit',
          input: {
            block_id: 'ghost-block',
            target_text: 'office plants and watering', // unique to the unsent far block
            new_text: 'desk plants',
            reason: 'test',
          },
        },
      ]),
    })
    expect(edits).toEqual([])
  })

  it('drops unanchorable proposals entirely', async () => {
    const state = stateOf(FIXTURE_DOC)
    const primary = primaryEditFor(FIXTURE_DOC, 'b1', 'March 1, 2026', 'June 1, 2026')
    const edits = await proposeCascadeEdits(state, primary, CONFIG, {
      graph: buildDeterministicGraph(FIXTURE_DOC),
      callStructured: scripted([
        {
          name: 'propose_edit',
          input: {
            block_id: 'b2',
            target_text: 'this text exists nowhere in the document',
            new_text: 'x',
            reason: 'test',
          },
        },
      ]),
    })
    expect(edits).toEqual([])
  })

  it('drops proposals overlapping the primary range', async () => {
    const state = stateOf(FIXTURE_DOC)
    const primary = primaryEditFor(FIXTURE_DOC, 'b1', 'March 1, 2026', 'June 1, 2026')
    const edits = await proposeCascadeEdits(state, primary, CONFIG, {
      graph: buildDeterministicGraph(FIXTURE_DOC),
      callStructured: scripted([
        {
          name: 'propose_edit',
          input: {
            block_id: 'b1',
            target_text: 'March 1, 2026', // the primary region itself
            new_text: 'June 1, 2026',
            reason: 'test',
          },
        },
      ]),
    })
    expect(edits).toEqual([])
  })
})

describe('proposeCascadeEdits — evidence gating and severity', () => {
  const primaryOf = (doc: PMNode) => primaryEditFor(doc, 'b1', 'March 1, 2026', 'June 1, 2026')

  function cascadeWith(input: Record<string, unknown>) {
    const state = stateOf(FIXTURE_DOC)
    return proposeCascadeEdits(state, primaryOf(FIXTURE_DOC), CONFIG, {
      graph: buildDeterministicGraph(FIXTURE_DOC),
      callStructured: scripted([{ name: 'propose_edit', input }]),
    })
  }

  it('cited + verbatim conflict in the target block → must', async () => {
    // b2 still contains the stale "March 1, 2026" the primary edit changes.
    const edits = await cascadeWith({
      block_id: 'b2',
      target_text: 'ends on March 1, 2026',
      new_text: 'ends on June 1, 2026',
      reason: 'stale date',
      source_block_id: 'b1',
      quoted_text: 'March 1, 2026',
      edge_type: 'contradicts',
    })
    expect(edits).toHaveLength(1)
    expect(edits[0].severity).toBe('must')
    expect(edits[0].evidence).toEqual({
      sourceBlockId: 'b1',
      quotedText: 'March 1, 2026',
      edgeType: 'contradicts',
    })
  })

  it('cited but no verbatim conflict → probably', async () => {
    // b3 references the Launch Date but contains no stale token.
    const edits = await cascadeWith({
      block_id: 'b3',
      target_text: 'two weeks ahead of the Launch Date',
      new_text: 'two weeks ahead of the new Launch Date',
      reason: 'dependent schedule',
      source_block_id: 'b1',
      quoted_text: 'Launch Date',
      edge_type: 'references',
    })
    expect(edits).toHaveLength(1)
    expect(edits[0].severity).toBe('probably')
  })

  it('a fabricated quote can never be must — downgraded to optional', async () => {
    const edits = await cascadeWith({
      block_id: 'b2',
      target_text: 'ends on March 1, 2026',
      new_text: 'ends on June 1, 2026',
      reason: 'stale date',
      source_block_id: 'b1',
      quoted_text: 'this quote does not exist in b1', // hallucinated citation
      edge_type: 'contradicts',
    })
    expect(edits).toHaveLength(1)
    expect(edits[0].severity).toBe('optional')
    expect(edits[0].evidence).toBeNull()
  })

  it('a missing citation → optional', async () => {
    const edits = await cascadeWith({
      block_id: 'b3',
      target_text: 'Marketing emails',
      new_text: 'Promotional emails',
      reason: 'style',
    })
    expect(edits).toHaveLength(1)
    expect(edits[0].severity).toBe('optional')
    expect(edits[0].evidence).toBeNull()
  })

  it('invalid edge_type is normalized to references, not dropped', async () => {
    const edits = await cascadeWith({
      block_id: 'b3',
      target_text: 'two weeks ahead',
      new_text: 'three weeks ahead',
      reason: 'test',
      source_block_id: 'b1',
      quoted_text: 'Launch Date',
      edge_type: 'made-up-edge',
    })
    expect(edits).toHaveLength(1)
    expect(edits[0].evidence?.edgeType).toBe('references')
  })

  it('sorts results by severity (must first)', async () => {
    const state = stateOf(FIXTURE_DOC)
    const edits = await proposeCascadeEdits(state, primaryOf(FIXTURE_DOC), CONFIG, {
      graph: buildDeterministicGraph(FIXTURE_DOC),
      callStructured: scripted([
        {
          name: 'propose_edit',
          input: {
            block_id: 'b3',
            target_text: 'Marketing emails',
            new_text: 'Promotional emails',
            reason: 'style, uncited',
          },
        },
        {
          name: 'propose_edit',
          input: {
            block_id: 'b2',
            target_text: 'ends on March 1, 2026',
            new_text: 'ends on June 1, 2026',
            reason: 'stale date',
            source_block_id: 'b1',
            quoted_text: 'March 1, 2026',
            edge_type: 'contradicts',
          },
        },
      ]),
    })
    expect(edits.map((e) => e.severity)).toEqual(['must', 'optional'])
  })
})

describe('severity primitives', () => {
  it('extractChangedTokens finds figures, quoted phrases, and removed words', () => {
    const tokens = extractChangedTokens(
      'The "Retention Period" lasts 90 days and costs $5,000.',
      'The "Grace Window" lasts 30 days and costs $2,500.',
    )
    expect(tokens).toContain('90')
    expect(tokens).toContain('$5,000')
    expect(tokens).toContain('Retention Period')
    expect(tokens).not.toContain('days')
  })

  it('hasVerbatimConflict detects the whole stale phrase and stale tokens', () => {
    expect(
      hasVerbatimConflict('Policy: retention lasts 90 days.', '90 days', '30 days'),
    ).toBe(true)
    expect(
      hasVerbatimConflict('Nothing stale in here.', '90 days', '30 days'),
    ).toBe(false)
  })

  it('deriveSeverity: null evidence is always optional regardless of conflict', () => {
    expect(deriveSeverity(null, 'contains 90 days', '90 days', '30 days')).toBe('optional')
  })

  it('primaryProposedEdit is must, uncited, and carries the blockId', () => {
    const edit = primaryProposedEdit(
      { from: 1, to: 5, newText: 'x', reason: 'r' },
      'orig',
      'b9',
    )
    expect(edit.severity).toBe('must')
    expect(edit.evidence).toBeNull()
    expect(edit.blockId).toBe('b9')
    expect(edit.relation).toBe('primary')
  })
})
