import { beforeEach, describe, expect, it, vi } from 'vitest'

class MemoryStorage {
  protected store = new Map<string, string>()

  getItem(key: string) {
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.store.set(key, value)
  }

  removeItem(key: string) {
    this.store.delete(key)
  }

  clear() {
    this.store.clear()
  }
}

/** Every setItem call throws QuotaExceededError — simulates a truly exhausted quota. */
class AlwaysQuotaStorage extends MemoryStorage {
  setItem(): void {
    const err = new Error('QuotaExceededError')
    err.name = 'QuotaExceededError'
    throw err
  }
}

/**
 * The first setItem call for `failingKey` throws QuotaExceededError;
 * subsequent calls (and calls for any other key) succeed normally.
 */
class FailOnceStorage extends MemoryStorage {
  private failed = false

  constructor(private readonly failingKey: string) {
    super()
  }

  setItem(key: string, value: string) {
    if (key === this.failingKey && !this.failed) {
      this.failed = true
      const err = new Error('QuotaExceededError')
      err.name = 'QuotaExceededError'
      throw err
    }
    super.setItem(key, value)
  }
}

async function loadStore() {
  vi.resetModules()
  return import('@/stores/sessionStore')
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
})

describe('sessionStore persistence bounds (#66)', () => {
  it('caps the persisted annotationHistory even as the in-memory string keeps growing past the cap', async () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    const { useSessionStore } = await loadStore()

    // One entry well past MAX_PERSISTED_HISTORY_CHARS (400_000), so a
    // regression that drops the `.slice()` cap leaves the full string
    // persisted instead.
    const bigEntry = 'x'.repeat(500_000)
    useSessionStore.getState().appendToHistory(bigEntry)

    // In-memory state is not trimmed — only what gets written to localStorage is.
    expect(useSessionStore.getState().context.annotationHistory).toHaveLength(bigEntry.length)

    const raw = storage.getItem('intent-ide-session')
    expect(raw).not.toBeNull()
    const persisted = JSON.parse(raw as string)
    const persistedHistory = persisted.state.context.annotationHistory as string

    expect(persistedHistory.length).toBe(400_000)
    // Oldest characters are evicted first; newest (tail) survive.
    expect(persistedHistory).toBe(bigEntry.slice(-400_000))
  })

  it('does not crash the store when localStorage.setItem always throws QuotaExceededError', async () => {
    vi.stubGlobal('localStorage', new AlwaysQuotaStorage())
    const { useSessionStore } = await loadStore()

    expect(() => useSessionStore.getState().appendToHistory('entry')).not.toThrow()
    // In-memory state still reflects the update even though persistence silently failed.
    expect(useSessionStore.getState().context.annotationHistory).toBe('entry')
  })

  it('emergency-prunes annotationHistory to EMERGENCY_HISTORY_CHARS and retries once when the first write hits QuotaExceededError', async () => {
    const storage = new FailOnceStorage('intent-ide-session')
    vi.stubGlobal('localStorage', storage)
    const { useSessionStore } = await loadStore()

    // A single write carrying well over the emergency cap (80_000), so a
    // regression that drops the emergency prune would leave the full,
    // unpruned string on the (successful) retry instead.
    const seeded = 'y'.repeat(150_000)
    expect(() =>
      useSessionStore.setState((s) => ({ context: { ...s.context, annotationHistory: seeded } }))
    ).not.toThrow()

    const raw = storage.getItem('intent-ide-session')
    expect(raw).not.toBeNull()
    const persisted = JSON.parse(raw as string)
    const persistedHistory = persisted.state.context.annotationHistory as string

    expect(persistedHistory.length).toBe(80_000)
    expect(persistedHistory).toBe(seeded.slice(-80_000))
  })
})
