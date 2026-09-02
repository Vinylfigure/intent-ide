import { afterEach, describe, it, expect, vi } from 'vitest'
import { normalizeClaudeModel } from '@/stores/settingsStore'

// normalizeClaudeModel maps a possibly-stale stored Claude model id to a current
// valid one.  Valid current ids pass through unchanged; any date-suffixed haiku
// alias collapses to the bare alias; everything else stale falls back to the
// safe, cheap Sonnet 4.6 default (never silently upgraded to a pricier model).

const SONNET_DEFAULT = 'claude-sonnet-4-6'

// ── Valid current ids pass through unchanged ──────────────────────────────────

describe('normalizeClaudeModel — valid current ids', () => {
  const valid = [
    'claude-opus-4-8',
    'claude-fable-5',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
    'claude-opus-4-6',
  ]

  for (const model of valid) {
    it(`passes through "${model}" unchanged`, () => {
      expect(normalizeClaudeModel(model)).toBe(model)
    })
  }

  it('preserves legacy-but-still-offered claude-opus-4-6', () => {
    // Opus 4.6 is marked "Legacy" in the picker but remains a valid id — it must
    // NOT be downgraded to the Sonnet default.
    expect(normalizeClaudeModel('claude-opus-4-6')).toBe('claude-opus-4-6')
  })
})

// ── Date-suffixed haiku aliases collapse to the bare alias ────────────────────

describe('normalizeClaudeModel — haiku date-suffix aliasing', () => {
  it('maps a date-suffixed haiku to the bare alias', () => {
    expect(normalizeClaudeModel('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5')
  })

  it('maps any claude-haiku-4-5* prefix variant to the bare alias', () => {
    expect(normalizeClaudeModel('claude-haiku-4-5-latest')).toBe('claude-haiku-4-5')
    expect(normalizeClaudeModel('claude-haiku-4-5-preview')).toBe('claude-haiku-4-5')
  })

  it('leaves the already-bare haiku alias untouched', () => {
    expect(normalizeClaudeModel('claude-haiku-4-5')).toBe('claude-haiku-4-5')
  })
})

// ── Retired / stale ids fall back to the Sonnet default ───────────────────────

describe('normalizeClaudeModel — retired/stale ids → Sonnet default', () => {
  const stale = [
    'claude-sonnet-4-5',
    'claude-3-5-sonnet-20241022',
    'claude-3-opus-20240229',
    'claude-2.1',
    'claude-sonnet-4-0',
    'gpt-4o',
    'some-garbage-model',
    '',
  ]

  for (const model of stale) {
    it(`maps stale id "${model}" → "${SONNET_DEFAULT}"`, () => {
      expect(normalizeClaudeModel(model)).toBe(SONNET_DEFAULT)
    })
  }

  it('does not upgrade a stale id to a pricier model (lands on Sonnet, not Opus/Fable)', () => {
    const result = normalizeClaudeModel('claude-3-5-sonnet-20241022')
    expect(result).toBe(SONNET_DEFAULT)
    expect(result).not.toBe('claude-opus-4-8')
    expect(result).not.toBe('claude-fable-5')
  })
})

// ── Idempotency ───────────────────────────────────────────────────────────────

describe('normalizeClaudeModel — idempotency', () => {
  it('normalizing a normalized value is stable', () => {
    const cases = ['claude-opus-4-8', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-5']
    for (const c of cases) {
      const once = normalizeClaudeModel(c)
      expect(normalizeClaudeModel(once)).toBe(once)
    }
  })
})

// ── Rehydrate migrations (onRehydrateStorage) ─────────────────────────────────
//
// Seed the persisted zustand snapshot into a stubbed localStorage, then import
// the store module fresh so persist rehydrates synchronously and the
// onRehydrateStorage migrations run.

async function loadStoreWithPersisted(llmConfig: Record<string, unknown>) {
  const backing = new Map<string, string>([
    [
      'intent-ide-settings',
      JSON.stringify({
        state: {
          llmConfig,
          whisperApiKey: '',
          embeddingsEnabled: true,
          judgeEnabled: true,
          telemetryEnabled: false,
        },
        version: 0,
      }),
    ],
  ])
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  })
  vi.resetModules()
  return import('@/stores/settingsStore')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('onRehydrateStorage — provider migrations', () => {
  it('resets an unknown persisted provider to the Claude defaults (provider AND model)', async () => {
    const { useSettingsStore } = await loadStoreWithPersisted({
      provider: 'groq',
      apiKey: 'gsk-old',
      model: 'mixtral-8x7b',
    })
    const { llmConfig } = useSettingsStore.getState()
    expect(llmConfig.provider).toBe('claude')
    expect(llmConfig.model).toBe('claude-sonnet-4-6')
  })

  it('never resolves an unknown provider to a pricier Claude model', async () => {
    const { useSettingsStore } = await loadStoreWithPersisted({
      provider: 'anthropic-legacy',
      apiKey: '',
      model: 'claude-opus-4-8',
    })
    const { llmConfig } = useSettingsStore.getState()
    expect(llmConfig.provider).toBe('claude')
    expect(llmConfig.model).toBe('claude-sonnet-4-6')
  })

  it('a persisted openrouter config survives rehydrate untouched', async () => {
    const persisted = {
      provider: 'openrouter',
      apiKey: 'sk-or-abc',
      model: 'anthropic/claude-sonnet-4.6',
      baseUrl: 'https://openrouter.ai/api/v1',
    }
    const { useSettingsStore } = await loadStoreWithPersisted(persisted)
    expect(useSettingsStore.getState().llmConfig).toMatchObject(persisted)
  })

  it('still normalizes stale Claude model ids on rehydrate', async () => {
    const { useSettingsStore } = await loadStoreWithPersisted({
      provider: 'claude',
      apiKey: 'k',
      model: 'claude-3-5-sonnet-20241022',
    })
    expect(useSettingsStore.getState().llmConfig.model).toBe('claude-sonnet-4-6')
  })
})

// ── graphEnrichment backfill (onRehydrateStorage) ─────────────────────────────
//
// Mirrors the embeddingsEnabled/judgeEnabled/telemetryEnabled backfill guards:
// a snapshot written before this field existed (or carrying a retired value)
// must land on the safe default, never silently upgrade to a setting that
// newly sends block text off-machine.

async function loadStoreWithPersistedTop(top: Record<string, unknown>) {
  const backing = new Map<string, string>([
    [
      'intent-ide-settings',
      JSON.stringify({
        state: {
          llmConfig: { provider: 'claude', apiKey: 'k', model: 'claude-sonnet-4-6' },
          whisperApiKey: '',
          embeddingsEnabled: true,
          judgeEnabled: true,
          telemetryEnabled: false,
          ...top,
        },
        version: 0,
      }),
    ],
  ])
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  })
  vi.resetModules()
  return import('@/stores/settingsStore')
}

describe('onRehydrateStorage — graphEnrichment backfill', () => {
  it('a snapshot written before this field existed backfills to the default local-only', async () => {
    const { useSettingsStore } = await loadStoreWithPersistedTop({})
    expect(useSettingsStore.getState().graphEnrichment).toBe('local-only')
  })

  it('a retired/garbage persisted value resets to local-only, never silently to "always"', async () => {
    const { useSettingsStore } = await loadStoreWithPersistedTop({ graphEnrichment: 'sometimes' })
    expect(useSettingsStore.getState().graphEnrichment).toBe('local-only')
  })

  it('a valid persisted value survives rehydrate untouched', async () => {
    const { useSettingsStore: offStore } = await loadStoreWithPersistedTop({ graphEnrichment: 'off' })
    expect(offStore.getState().graphEnrichment).toBe('off')

    const { useSettingsStore: alwaysStore } = await loadStoreWithPersistedTop({
      graphEnrichment: 'always',
    })
    expect(alwaysStore.getState().graphEnrichment).toBe('always')
  })
})
