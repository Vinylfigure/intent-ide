import { describe, it, expect, beforeEach } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { schema } from '@/lib/prosemirror/schema'
import type { LLMConfig } from '@/stores/settingsStore'
import type { CallStructuredFn, StructuredRequest } from '@/lib/ai/structuredClient'
import type { ProposedEdit } from '@/lib/annotations/types'
import { judgeMustCandidates, type JudgeFn, type JudgeVerdict } from '@/lib/ai/relevanceJudge'
import { buildDeterministicGraph, augmentWithLlmEdges, invalidateDocGraphCache, type DocGraph } from '../docGraph'
import { runAblationArm, ABLATION_ARMS, type ArmId } from '../ablationArms'
import { CASCADE_FIXTURES, resolvePrimary, type CascadeFixture } from './editPropBench.fixtures'

/**
 * Ablation harness SCAFFOLDING (issue #27, precursor to issue #19's live
 * comparative run). Runs arms B, C, D — and their cheap-model (arm E)
 * variants — against the existing EditPropBench fixtures with the SCRIPTED
 * model (never a live provider; BENCH_LIVE is irrelevant here and never
 * read). The fixtures' scripted tool calls are model-agnostic canned
 * responses, so the SAME `scriptedCascadeCalls` exercise every arm's real
 * anchoring/evidence/severity/verify pipeline without a network call.
 *
 * This file asserts the harness RUNS CLEANLY and produces the metrics shape
 * end to end — it is deliberately NOT a quality gate on arms B/D the way
 * `editPropBench.test.ts` is for arm C: those arms are unproven scaffolding
 * whose actual recall/collateral-damage numbers are exactly what the live
 * comparative run (blocked on an operator-supplied key, #19) exists to
 * measure. Fixture `extraAssertions` are arm-C-specific (they assert on
 * graph-SCOPED prompt content, e.g. "far filler blocks are never sent") and
 * are intentionally not replayed for B/D, which see the whole document by
 * design.
 */

const CONFIG: LLMConfig = { provider: 'claude', apiKey: 'bench-key', model: 'bench-model' }

// Provider-failure fixtures exist to script a dead transport for one arm's
// call shape; every arm must degrade to [] on a thrown call, so keep them.
const FIXTURES = CASCADE_FIXTURES

interface AblationMetrics {
  fixture: string
  arm: string
  cheapModel: boolean
  recall: number | null
  /** must/probably proposals landing on a protected span — precision gate. */
  protectedSpanViolations: number
  /** ANY proposal (any severity) landing on a protected span — broader collateral measure. */
  collateralDamageCount: number
  proposals: number
  musts: number
  validCitations: number
}

const collected: AblationMetrics[] = []

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

const confirmAllJudge: JudgeFn = async (candidates) =>
  new Map(
    candidates.map((_, i): [number, JudgeVerdict] => [
      i,
      { genuinelyConflicts: true, reason: 'confirmed' },
    ]),
  )

function scriptedJudge(
  calls: Array<{ name: string; input: Record<string, unknown> }>,
  capture: StructuredRequest[],
): JudgeFn {
  return (candidates, primary, doc, config) =>
    judgeMustCandidates(candidates, primary, doc, config, scripted(calls, capture))
}

function computeMetrics(
  fixture: CascadeFixture,
  arm: string,
  cheapModel: boolean,
  edits: ProposedEdit[],
): AblationMetrics {
  const { requiredDownstream, protectedUnchanged } = fixture.labels
  const proposedBlockIds = new Set(edits.map((e) => e.blockId).filter(Boolean))

  const recall =
    requiredDownstream.length === 0
      ? null
      : requiredDownstream.filter((id) => proposedBlockIds.has(id)).length /
        requiredDownstream.length

  const protectedSpanViolations = edits.filter(
    (e) =>
      (e.severity === 'must' || e.severity === 'probably') &&
      e.blockId !== undefined &&
      protectedUnchanged.includes(e.blockId),
  ).length

  const collateralDamageCount = edits.filter(
    (e) => e.blockId !== undefined && protectedUnchanged.includes(e.blockId),
  ).length

  const musts = edits.filter((e) => e.severity === 'must')
  return {
    fixture: fixture.name,
    arm,
    cheapModel,
    recall,
    protectedSpanViolations,
    collateralDamageCount,
    proposals: edits.length,
    musts: musts.length,
    validCitations: musts.filter((m) => m.evidence !== null).length,
  }
}

beforeEach(() => {
  invalidateDocGraphCache()
})

describe('Ablation harness — arms B/C/D × cheap-model dry run (scripted model, no live key)', () => {
  for (const armId of ABLATION_ARMS) {
    for (const cheapModel of [false, true]) {
      describe(`arm ${armId}${cheapModel ? ' (cheap-model / arm E variant)' : ''}`, () => {
        for (const fixture of FIXTURES) {
          it(fixture.name, async () => {
            const doc = fixture.buildDoc()
            const state = EditorState.create({ schema, doc })
            const primary = resolvePrimary(doc, fixture)
            const captured: StructuredRequest[] = []

            let graph: DocGraph | undefined
            if (armId === 'C') {
              graph = buildDeterministicGraph(doc)
              if (fixture.scriptedGraphCalls) {
                await augmentWithLlmEdges(graph, CONFIG, scripted(fixture.scriptedGraphCalls, []))
              }
            }

            const edits = await runAblationArm(armId as ArmId, state, primary, CONFIG, {
              graph,
              callStructured: scripted(fixture.scriptedCascadeCalls, captured, fixture.throwOnCascade),
              judge: fixture.scriptedJudgeCalls
                ? scriptedJudge(fixture.scriptedJudgeCalls, captured)
                : confirmAllJudge,
              cheapModel,
            })

            // No throw, and the metrics shape computes cleanly from whatever
            // came back — that IS the done-means for this scaffolding task.
            const metrics = computeMetrics(fixture, armId, cheapModel, edits)
            collected.push(metrics)

            expect(Array.isArray(edits)).toBe(true)
            expect(metrics.recall === null || (metrics.recall >= 0 && metrics.recall <= 1)).toBe(true)
            expect(metrics.protectedSpanViolations).toBeGreaterThanOrEqual(0)
            expect(metrics.collateralDamageCount).toBeGreaterThanOrEqual(0)
            expect(metrics.collateralDamageCount).toBeGreaterThanOrEqual(metrics.protectedSpanViolations)

            // The primary's own block must never come back as a cascade,
            // regardless of arm — this is anchoring behavior every arm shares.
            for (const edit of edits) {
              expect(fixture.labels.directTargets).not.toContain(edit.blockId)
            }

            // Citation validity is unconditional: every 'must' this harness
            // ever returns re-verifies verbatim against the live document,
            // because 'must' can only come from deriveSeverity's own
            // verbatim check inside resolveProposedEdits — shared by every arm.
            for (const must of edits.filter((e) => e.severity === 'must')) {
              expect(must.evidence).not.toBeNull()
            }
          })
        }
      })
    }
  }

  it('aggregate: every arm × fixture combination produced a well-formed metrics row', () => {
    // 3 arms × 2 model tiers × N fixtures.
    expect(collected.length).toBe(ABLATION_ARMS.length * 2 * FIXTURES.length)
    for (const m of collected) {
      expect(Number.isFinite(m.proposals)).toBe(true)
      expect(Number.isFinite(m.musts)).toBe(true)
      expect(Number.isFinite(m.validCitations)).toBe(true)
      expect(m.validCitations).toBeLessThanOrEqual(m.musts)
    }
  })
})
