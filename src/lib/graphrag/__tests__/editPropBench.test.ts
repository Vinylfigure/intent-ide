import { describe, it, expect, afterAll, beforeEach } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { schema } from '@/lib/prosemirror/schema'
import { blockTextRange } from '@/lib/prosemirror/blockIds'
import type { LLMConfig } from '@/stores/settingsStore'
import type { CallStructuredFn, StructuredRequest } from '@/lib/ai/structuredClient'
import type { ProposedEdit } from '@/lib/annotations/types'
import { proposeCascadeEdits } from '@/lib/ai/orchestrator'
import { judgeMustCandidates, type JudgeFn, type JudgeVerdict } from '@/lib/ai/relevanceJudge'
import { buildDeterministicGraph, augmentWithLlmEdges, invalidateDocGraphCache } from '../docGraph'
import { CASCADE_FIXTURES, resolvePrimary, type CascadeFixture } from './editPropBench.fixtures'

/**
 * EditPropBench-grounded regression gate (label taxonomy from
 * arXiv:2605.02083: direct-target / required-downstream / protected-unchanged).
 *
 * Scripted structured responses play the model; everything else — graph build,
 * neighborhood scoping, blockId anchoring, evidence verification, severity
 * derivation — is the production pipeline. Three metrics per fixture:
 * - recall:    required-downstream blocks the surviving proposals cover
 * - precision: no must/probably proposal touches a protected block (hard 0 violations)
 * - citation validity: every 'must' carries evidence whose quote re-verifies
 *   verbatim against the live document
 */

const CONFIG: LLMConfig = { provider: 'claude', apiKey: 'bench-key', model: 'bench-model' }

interface FixtureMetrics {
  fixture: string
  recall: number | null // null when the fixture labels no required downstream
  fpViolations: number
  musts: number
  validCitations: number
}

const collected: FixtureMetrics[] = []

function scripted(
  calls: Array<{ name: string; input: Record<string, unknown> }>,
  capture: StructuredRequest[],
  throwOnCall = false,
): CallStructuredFn {
  return async (req) => {
    capture.push(req)
    if (throwOnCall) throw new Error('bench: provider down')
    return { toolCalls: calls }
  }
}

/** Default judge: confirm every derived must so unjudged fixtures keep their labels. */
const confirmAllJudge: JudgeFn = async (candidates) =>
  new Map(
    candidates.map((_, i): [number, JudgeVerdict] => [
      i,
      { genuinelyConflicts: true, reason: 'confirmed' },
    ]),
  )

/** Scripted judge: the real judgeMustCandidates parsing over scripted verdicts. */
function scriptedJudge(
  calls: Array<{ name: string; input: Record<string, unknown> }>,
  capture: StructuredRequest[],
): JudgeFn {
  return (candidates, primary, doc, config) =>
    judgeMustCandidates(candidates, primary, doc, config, scripted(calls, capture))
}

async function runFixture(fixture: CascadeFixture): Promise<{
  edits: ProposedEdit[]
  captured: StructuredRequest[]
  doc: ReturnType<CascadeFixture['buildDoc']>
}> {
  const doc = fixture.buildDoc()
  const state = EditorState.create({ schema, doc })
  const primary = resolvePrimary(doc, fixture)

  const graph = buildDeterministicGraph(doc)
  if (fixture.scriptedGraphCalls) {
    await augmentWithLlmEdges(graph, CONFIG, scripted(fixture.scriptedGraphCalls, []))
  }

  // Cascade AND judge requests share one capture list, so fixtures can
  // assert what the judge was actually shown (e.g. target-block context).
  const captured: StructuredRequest[] = []
  const edits = await proposeCascadeEdits(state, primary, CONFIG, {
    graph,
    callStructured: scripted(fixture.scriptedCascadeCalls, captured, fixture.throwOnCascade),
    judge: fixture.scriptedJudgeCalls
      ? scriptedJudge(fixture.scriptedJudgeCalls, captured)
      : confirmAllJudge,
  })
  return { edits, captured, doc }
}

function computeMetrics(fixture: CascadeFixture, edits: ProposedEdit[]): FixtureMetrics {
  const { requiredDownstream, protectedUnchanged } = fixture.labels
  const proposedBlockIds = new Set(edits.map((e) => e.blockId).filter(Boolean))

  const recall =
    requiredDownstream.length === 0
      ? null
      : requiredDownstream.filter((id) => proposedBlockIds.has(id)).length /
        requiredDownstream.length

  const fpViolations = edits.filter(
    (e) =>
      (e.severity === 'must' || e.severity === 'probably') &&
      e.blockId !== undefined &&
      protectedUnchanged.includes(e.blockId),
  ).length

  const musts = edits.filter((e) => e.severity === 'must')
  return {
    fixture: fixture.name,
    recall,
    fpViolations,
    musts: musts.length,
    validCitations: musts.filter((m) => m.evidence !== null).length,
  }
}

beforeEach(() => {
  invalidateDocGraphCache()
})

describe('EditPropBench cascade regression gate', () => {
  for (const fixture of CASCADE_FIXTURES) {
    it(fixture.name, async () => {
      const { edits, captured, doc } = await runFixture(fixture)
      const metrics = computeMetrics(fixture, edits)
      collected.push(metrics)

      // Recall: every labeled required-downstream block is covered.
      if (metrics.recall !== null) expect(metrics.recall).toBe(1)

      // Precision: zero must/probably proposals on protected blocks.
      expect(metrics.fpViolations).toBe(0)

      // Direct targets (the primary's own block) never appear as cascades.
      for (const edit of edits) {
        expect(fixture.labels.directTargets).not.toContain(edit.blockId)
      }

      // Citation validity: every 'must' cites evidence that re-verifies
      // verbatim against the live document.
      for (const must of edits.filter((e) => e.severity === 'must')) {
        expect(must.evidence).not.toBeNull()
        expect(
          blockTextRange(doc, must.evidence!.sourceBlockId, must.evidence!.quotedText),
        ).not.toBeNull()
      }

      fixture.extraAssertions?.(edits, captured, doc)
    })
  }

  it('aggregate: recall ≥ 0.9, zero violations, 100% citation validity', () => {
    const withRecall = collected.filter((m) => m.recall !== null)
    expect(withRecall.length).toBeGreaterThanOrEqual(4)
    const aggregateRecall =
      withRecall.reduce((sum, m) => sum + (m.recall ?? 0), 0) / withRecall.length
    expect(aggregateRecall).toBeGreaterThanOrEqual(0.9)

    expect(collected.reduce((sum, m) => sum + m.fpViolations, 0)).toBe(0)

    const totalMusts = collected.reduce((sum, m) => sum + m.musts, 0)
    const totalValid = collected.reduce((sum, m) => sum + m.validCitations, 0)
    expect(totalMusts).toBeGreaterThan(0)
    expect(totalValid).toBe(totalMusts)
  })
})

afterAll(() => {
  // Human-readable bench report in the vitest output.
  // eslint-disable-next-line no-console
  console.table(
    collected.map((m) => ({
      fixture: m.fixture.length > 56 ? `${m.fixture.slice(0, 53)}…` : m.fixture,
      recall: m.recall === null ? 'n/a' : m.recall.toFixed(2),
      'fp violations': m.fpViolations,
      musts: m.musts,
      'valid citations': m.validCitations,
    })),
  )
})
