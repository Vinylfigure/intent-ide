import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '@/stores/sessionStore'
import { maybeCompactContext } from '../resolver'

// #75: maybeCompactContext()'s final session.updateContext() is a whole-field
// overwrite of annotationHistory computed from a pre-compaction snapshot. If
// an unrelated resolution finishes and calls appendToHistory() while this
// compaction's LLM call is still in flight, that overwrite silently discards
// the just-appended entry. This asserts the appended suffix survives.

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

describe('maybeCompactContext preserves a concurrent appendToHistory', () => {
  it('keeps a history entry appended while the compaction fetch is still pending', async () => {
    useSessionStore.getState().updateContext({ annotationHistory: LARGE_HISTORY })

    const gate = deferred<void>()
    const fetchMock = vi.fn(async () => {
      // An unrelated resolution finishes mid-compaction and appends to the
      // live history before this compaction's fetch resolves.
      useSessionStore.getState().appendToHistory('unrelated resolution entry')
      await gate.promise
      return {
        ok: true,
        json: async () => ({ content: 'compacted summary' }),
      } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    const compaction = maybeCompactContext()
    await Promise.resolve()
    gate.resolve()
    await compaction

    expect(useSessionStore.getState().context.annotationHistory).toBe(
      '[Compacted session summary]\ncompacted summary\nunrelated resolution entry',
    )
  })

  it('skips the write when the live history no longer starts with what was summarized', async () => {
    useSessionStore.getState().updateContext({ annotationHistory: LARGE_HISTORY })

    const gate = deferred<void>()
    const fetchMock = vi.fn(async () => {
      // Live history changed in a way that isn't a pure append on top of the
      // pre-compaction snapshot (e.g. a session reset) — the summary is now
      // based on stale data, so the fix should not force it back in.
      useSessionStore.getState().reset()
      useSessionStore.getState().updateContext({ annotationHistory: 'fresh session history' })
      await gate.promise
      return {
        ok: true,
        json: async () => ({ content: 'compacted summary' }),
      } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    const compaction = maybeCompactContext()
    await Promise.resolve()
    gate.resolve()
    await compaction

    expect(useSessionStore.getState().context.annotationHistory).toBe('fresh session history')
  })
})
