import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { schema } from '@/lib/prosemirror/schema'
import { blockTextRange } from '@/lib/prosemirror/blockIds'
import type { LLMConfig, LLMProvider } from '@/stores/settingsStore'
import type { ProposedEdit } from '@/lib/annotations/types'
import { setStructuredBaseUrl } from '@/lib/ai/structuredClient'
import { proposeCascadeEdits } from '@/lib/ai/orchestrator'
import { buildDeterministicGraph, augmentWithLlmEdges, invalidateDocGraphCache } from '../docGraph'
import { CASCADE_FIXTURES, resolvePrimary, type CascadeFixture } from './editPropBench.fixtures'

/**
 * LIVE EditPropBench run — opt-in only, never CI.
 *
 * Replays the CASCADE_FIXTURES against a REAL model through the running app's
 * /api/structured route: graph extraction, cascade proposal, and relevance
 * judging all use the production fetchStructured (no scripted calls). Real
 * models vary run to run, so nothing is hard-asserted except citation
 * validity; recall/precision are REPORTED via console.table and written as
 * per-fixture JSON under bench-results/ for comparison across models.
 *
 * Two-terminal flow:
 *   1. Terminal A: npm run dev            # serves /api/structured on :3000
 *   2. Terminal B: BENCH_PROVIDER=claude BENCH_MODEL=claude-sonnet-4-6 \
 *        BENCH_API_KEY=sk-ant-... npm run bench:live
 *
 * Env:
 *   BENCH_LIVE=1        gate — anything else skips the whole suite
 *   BENCH_BASE_URL      app origin (default http://localhost:3000)
 *   BENCH_PROVIDER      claude | openai | ollama (default claude)
 *   BENCH_MODEL         model id (default claude-sonnet-4-6)
 *   BENCH_API_KEY       provider key (Ollama needs none)
 */

const LIVE = process.env.BENCH_LIVE === '1'

const RESULTS_DIR = path.join(process.cwd(), 'bench-results')
const FIXTURE_TIMEOUT_MS = 120_000

// Provider-failure fixtures exist to script a dead transport — meaningless live.
const LIVE_FIXTURES = CASCADE_FIXTURES.filter((f) => !f.throwOnCascade)

interface LiveMetrics {
  fixture: string
  provider: string
  model: string
  recall: number | null
  fpViolations: number
  proposals: number
  musts: number
  validCitations: number
  durationMs: number
}

const collected: LiveMetrics[] = []

function benchConfig(): LLMConfig {
  return {
    provider: (process.env.BENCH_PROVIDER || 'claude') as LLMProvider,
    model: process.env.BENCH_MODEL || 'claude-sonnet-4-6',
    apiKey: process.env.BENCH_API_KEY || '',
  }
}

function computeLiveMetrics(
  fixture: CascadeFixture,
  edits: ProposedEdit[],
  config: LLMConfig,
  durationMs: number,
): LiveMetrics {
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
    provider: config.provider,
    model: config.model,
    recall,
    fpViolations,
    proposals: edits.length,
    musts: musts.length,
    validCitations: musts.filter((m) => m.evidence !== null).length,
    durationMs,
  }
}

describe.skipIf(!LIVE)('EditPropBench LIVE (real model via /api/structured)', () => {
  beforeAll(async () => {
    const baseUrl = process.env.BENCH_BASE_URL || 'http://localhost:3000'
    // Preflight: fail fast on a dead transport instead of burning the full
    // retry backoff once per fixture and reporting all-zero "results".
    try {
      await fetch(baseUrl)
    } catch {
      throw new Error(
        `bench:live — ${baseUrl} is unreachable. Start the app first (npm run dev) or point BENCH_BASE_URL at a running instance.`,
      )
    }
    setStructuredBaseUrl(baseUrl)
    fs.mkdirSync(RESULTS_DIR, { recursive: true })
    const config = benchConfig()
    if (config.provider !== 'ollama' && !config.apiKey) {
      // eslint-disable-next-line no-console
      console.warn(
        'bench:live — no BENCH_API_KEY set; non-Ollama runs will skip the LLM graph pass and cascade calls will 401.',
      )
    }
  })

  beforeEach(() => {
    invalidateDocGraphCache()
  })

  for (const fixture of LIVE_FIXTURES) {
    it(
      fixture.name,
      async () => {
        const doc = fixture.buildDoc()
        const state = EditorState.create({ schema, doc })
        const primary = resolvePrimary(doc, fixture)
        const config = benchConfig()

        const started = Date.now()
        // Real LLM graph augmentation over the deterministic base…
        const graph = buildDeterministicGraph(doc)
        await augmentWithLlmEdges(graph, config)
        // …and a real cascade + relevance judge (default fetchStructured, default judge).
        const edits = await proposeCascadeEdits(state, primary, config, { graph })
        const durationMs = Date.now() - started

        const metrics = computeLiveMetrics(fixture, edits, config, durationMs)
        collected.push(metrics)

        // The ONLY hard gate: every surviving 'must' must carry a citation
        // that re-verifies verbatim against the live document. Recall and
        // precision are reported, not asserted — real models vary.
        for (const must of edits.filter((e) => e.severity === 'must')) {
          expect(must.evidence).not.toBeNull()
          expect(
            blockTextRange(doc, must.evidence!.sourceBlockId, must.evidence!.quotedText),
          ).not.toBeNull()
        }

        const slug = fixture.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)
        fs.writeFileSync(
          path.join(RESULTS_DIR, `${slug}.json`),
          JSON.stringify({ ...metrics, edits, ranAt: new Date().toISOString() }, null, 2),
        )
      },
      FIXTURE_TIMEOUT_MS,
    )
  }

  afterAll(() => {
    // Leave no cross-suite residue: later suites must see the default
    // relative '/api/structured' again.
    setStructuredBaseUrl('')
    if (collected.length === 0) return
    // eslint-disable-next-line no-console
    console.table(
      collected.map((m) => ({
        fixture: m.fixture.length > 48 ? `${m.fixture.slice(0, 45)}…` : m.fixture,
        recall: m.recall === null ? 'n/a' : m.recall.toFixed(2),
        'fp violations': m.fpViolations,
        proposals: m.proposals,
        musts: m.musts,
        'valid citations': m.validCitations,
        'ms': m.durationMs,
      })),
    )
    // A run where NO fixture produced a single proposal is a dead or broken
    // transport wearing green, not a model opinion — every fixture here has
    // at least one genuinely stale downstream block. Fail loudly rather than
    // greenwash it.
    expect(
      collected.some((m) => m.proposals > 0),
      'bench:live — zero proposals across ALL fixtures; the transport or provider is almost certainly broken (check the dev server logs and BENCH_API_KEY)',
    ).toBe(true)
  })
})
