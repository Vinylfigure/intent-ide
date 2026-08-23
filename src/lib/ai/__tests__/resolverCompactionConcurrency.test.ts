import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '@/stores/sessionStore'
import { maybeCompactContext } from '../resolver'

// #71: maybeCompactContext() had no concurrency guard. Two callers
// (resolveAnnotation / streamResolveAnnotation / continueThread invoked in
// quick succession) that both observe annotationHistory above threshold each
// fired their own /api/resolve compaction request and raced on the final
// session.updateContext() write — last writer wins, silently discarding the
// other compaction's result and its LLM spend. This asserts concurrent
// callers now share a single in-flight compaction instead.

const LARGE_HISTORY = 'x'.repeat(64000 * 4) // estimatedTokens === COMPACTION_THRESHOLD_TOKENS

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.unstubAllGlobals()
  useSessionStore.getState().reset()
})

describe('maybeCompactContext concurrency guard', () => {
  it('fires exactly one /api/resolve compaction call for two overlapping invocations', async () => {
    useSessionStore.getState().updateContext({ annotationHistory: LARGE_HISTORY })

    const gate = deferred<void>()
    let fetchCalls = 0
    const fetchMock = vi.fn(async () => {
      fetchCalls += 1
      await gate.promise
      return {
        ok: true,
        json: async () => ({ content: 'compacted summary' }),
      } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    // Two callers race in without either having resolved yet.
    const first = maybeCompactContext()
    const second = maybeCompactContext()

    // Let both callers reach their fetch() call before releasing the response.
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchCalls).toBe(1)

    gate.resolve()
    await Promise.all([first, second])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(useSessionStore.getState().context.annotationHistory).toBe(
      '[Compacted session summary]\ncompacted summary',
    )
  })

  it('allows a new compaction after the in-flight one settles', async () => {
    useSessionStore.getState().updateContext({ annotationHistory: LARGE_HISTORY })

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ content: 'first summary' }),
    })) as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchMock)

    await maybeCompactContext()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Grow history back above threshold and compact again — this must fire
    // its own request, not silently no-op because a stale guard never cleared.
    useSessionStore.getState().updateContext({ annotationHistory: LARGE_HISTORY })
    await maybeCompactContext()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
