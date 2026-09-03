'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type LLMProvider = 'claude' | 'openai' | 'openrouter' | 'ollama'

export interface LLMConfig {
  provider: LLMProvider
  apiKey: string
  model: string
  baseUrl?: string
  /**
   * Embedding model for the doc-graph paraphrase pass (sent as x-embed-model
   * to /api/embed). No UI yet — Wave C exposes it; unset uses the route's
   * per-provider default.
   */
  embedModel?: string
  /**
   * Requested context window in tokens, sent as x-context-tokens and consumed
   * only by the Ollama dialect as `options.num_ctx`.
   *
   * Ollama defaults every model to 4096 regardless of what it can actually
   * hold (qwen3:8b advertises 40960) and truncates an over-long prompt SILENTLY
   * — no error, just an answer grounded in half the evidence. Unset means "use
   * Ollama's default", which is exactly that failure, so local setups should
   * raise it. Bounded upward because context costs KV-cache memory: 32k on an
   * 8B model is a few GB, and Ollama itself clamps down to the model's real
   * limit, so an over-request is safe.
   */
  contextTokens?: number
}

/** Raised over Ollama's 4096 default; still modest enough for an 8B model. */
export const DEFAULT_OLLAMA_CONTEXT_TOKENS = 16384

/** Offered in the settings UI. Free-text entry is not restricted to these. */
export const CONTEXT_TOKEN_CHOICES = [4096, 8192, 16384, 32768] as const

export const PROVIDER_MODELS: Record<LLMProvider, { label: string; value: string }[]> = {
  claude: [
    { label: 'Claude Sonnet 4.6 (Recommended — fast)', value: 'claude-sonnet-4-6' },
    { label: 'Claude Opus 4.8 (Most capable — higher cost)', value: 'claude-opus-4-8' },
    { label: 'Claude Fable 5 (Frontier — highest cost)', value: 'claude-fable-5' },
    { label: 'Claude Haiku 4.5 (Cheapest)', value: 'claude-haiku-4-5' },
    { label: 'Claude Opus 4.6 (Legacy)', value: 'claude-opus-4-6' },
  ],
  openai: [
    { label: 'GPT-4o (Recommended)', value: 'gpt-4o' },
    { label: 'GPT-4o mini', value: 'gpt-4o-mini' },
    { label: 'GPT-4 Turbo', value: 'gpt-4-turbo' },
  ],
  openrouter: [
    { label: 'Claude Sonnet 4.6 (Recommended)', value: 'anthropic/claude-sonnet-4.6' },
    { label: 'GPT-4o', value: 'openai/gpt-4o' },
    { label: 'Llama 3.3 70B Instruct', value: 'meta-llama/llama-3.3-70b-instruct' },
    { label: 'DeepSeek Chat', value: 'deepseek/deepseek-chat' },
  ],
  ollama: [
    { label: 'qwen3:8b (Recommended)', value: 'qwen3:8b' },
    { label: 'qwen3', value: 'qwen3' },
    { label: 'llama3.2', value: 'llama3.2' },
    { label: 'llama3.1', value: 'llama3.1' },
    { label: 'mistral', value: 'mistral' },
    { label: 'qwen2.5', value: 'qwen2.5' },
    { label: 'deepseek-r1', value: 'deepseek-r1' },
    { label: 'phi3', value: 'phi3' },
  ],
}

export const PROVIDER_DEFAULT_MODEL: Record<LLMProvider, string> = {
  claude: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  openrouter: 'anthropic/claude-sonnet-4.6',
  ollama: 'qwen3:8b',
}

// Providers the current build knows how to talk to. Anything else found in a
// persisted snapshot (renamed/retired provider ids) is reset on rehydrate.
const VALID_PROVIDERS = new Set<string>(['claude', 'openai', 'openrouter', 'ollama'])

// Claude model IDs currently offered. Anything else stored in localStorage from
// an older build (retired models, date-suffixed aliases, prior Opus variants) is
// migrated to the Sonnet 4.6 default on rehydrate — never silently upgraded to a
// pricier model.
const VALID_CLAUDE_MODELS = new Set(
  PROVIDER_MODELS.claude.map((m) => m.value)
)

/** Map a possibly-stale stored Claude model ID to a current, valid one. */
export function normalizeClaudeModel(model: string): string {
  if (VALID_CLAUDE_MODELS.has(model)) return model
  // Date-suffixed haiku alias → bare alias.
  if (model.startsWith('claude-haiku-4-5')) return 'claude-haiku-4-5'
  // Everything else stale (retired Sonnet/Opus/3.x) → safe, cheap default.
  return PROVIDER_DEFAULT_MODEL.claude
}

export const PROVIDER_BASE_URLS: Record<LLMProvider, string | undefined> = {
  claude: undefined,
  openai: undefined,
  openrouter: 'https://openrouter.ai/api/v1',
  ollama: 'http://localhost:11434',
}

/**
 * Privacy gate for the idle background enrichment pass
 * (`scheduleDocGraphEnrichment` in docGraph.ts), which embeds block text on a
 * long idle timer while the user is just reading — no annotation resolved, no
 * explicit user action.
 *
 * - 'off': never enrich.
 * - 'local-only' (default): enrich only when the configured provider is
 *   'ollama' — vectors never leave the machine, which is the user's actual
 *   working setup (nomic-embed-text via /api/embed's Ollama branch).
 * - 'always': opt in to sending block text to a hosted embeddings API
 *   (OpenAI) on idle, not just when the user explicitly triggers a cascade.
 */
export type GraphEnrichmentSetting = 'off' | 'local-only' | 'always'

const VALID_GRAPH_ENRICHMENT_SETTINGS = new Set<string>(['off', 'local-only', 'always'])

interface SettingsState {
  llmConfig: LLMConfig
  whisperApiKey: string
  showApiKeyModal: boolean
  /**
   * Embedding-based paraphrase edges in the doc graph (default on). Silently
   * inert for providers without an embeddings API (Anthropic).
   */
  embeddingsEnabled: boolean
  /**
   * Second-pass citation verification for 'must'-severity cascade candidates
   * (default on). One extra small-model call per cascade run; when off, the
   * derived severities stand unverified.
   */
  judgeEnabled: boolean
  /**
   * LLM entailment checking for semantic declared facts the deterministic
   * doc-CI lane cannot check — word-form numbers, dates, claims with no
   * exact-match anchor (default OFF). When on, applying an AI change sends
   * the declared statement and a bounded set of candidate passages to the
   * small model. Off by default because it is the only doc-CI path that costs
   * money and sends document text; the deterministic lane stays local and
   * always-on either way.
   */
  invariantEntailmentEnabled: boolean
  /**
   * When consistency and ripple checks run.
   *
   * 'commit'  — at the existing autosave settle point, buffered and batched.
   * 'demand'  — never in the background; only when explicitly asked.
   * 'off'     — not at all.
   *
   * Default 'commit', and NEVER on keystroke. Published contradiction detectors
   * run at roughly 16% precision for NLI-only pairwise detection and about 89%
   * for the best hybrid; legal redlining products treat under 15% false
   * positives as the bar for adoption. At keystroke cadence a checker that is
   * wrong one time in three to six is a feature switched off within a week.
   * Deferring to a settle point also matches the interruption-cost evidence:
   * coarser breakpoints cost less to resume from than finer ones.
   */
  consistencyCheckMode: ConsistencyCheckMode
  /**
   * Anonymous severity-calibration telemetry (default OFF — public repo,
   * other users). When on, cascade accept/reject decisions send metadata-only
   * events (severity × action, never document content or ids) to PostHog if
   * one is wired. The local calibration aggregate records regardless — it
   * never leaves the machine.
   */
  telemetryEnabled: boolean
  /** See `GraphEnrichmentSetting` above. Default 'local-only'. */
  graphEnrichment: GraphEnrichmentSetting
  setLLMConfig: (config: Partial<LLMConfig>) => void
  setContextTokens: (tokens: number) => void
  setWhisperKey: (key: string) => void
  setShowApiKeyModal: (show: boolean) => void
  setEmbeddingsEnabled: (enabled: boolean) => void
  setJudgeEnabled: (enabled: boolean) => void
  setInvariantEntailmentEnabled: (enabled: boolean) => void
  setConsistencyCheckMode: (mode: ConsistencyCheckMode) => void
  setTelemetryEnabled: (enabled: boolean) => void
  setGraphEnrichment: (setting: GraphEnrichmentSetting) => void
  hasKeys: () => boolean
}

export type ConsistencyCheckMode = 'commit' | 'demand' | 'off'

const CONSISTENCY_CHECK_MODES: ConsistencyCheckMode[] = ['commit', 'demand', 'off']

/** A snapshot from an older build carries no mode at all; fall back to the default. */
export function normalizeConsistencyCheckMode(value: unknown): ConsistencyCheckMode {
  return CONSISTENCY_CHECK_MODES.includes(value as ConsistencyCheckMode)
    ? (value as ConsistencyCheckMode)
    : 'commit'
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      llmConfig: {
        provider: 'claude',
        apiKey: '',
        model: 'claude-sonnet-4-6',
        baseUrl: undefined,
        contextTokens: DEFAULT_OLLAMA_CONTEXT_TOKENS,
      },
      whisperApiKey: '',
      showApiKeyModal: false,
      embeddingsEnabled: true,
      judgeEnabled: true,
      invariantEntailmentEnabled: false,
      consistencyCheckMode: 'commit' as ConsistencyCheckMode,
      telemetryEnabled: false,
      graphEnrichment: 'local-only',
      setLLMConfig: (config) =>
        set((s) => ({ llmConfig: { ...s.llmConfig, ...config } })),
      setContextTokens: (tokens) =>
        set((s) => ({ llmConfig: { ...s.llmConfig, contextTokens: tokens } })),
      setWhisperKey: (key) => set({ whisperApiKey: key }),
      setShowApiKeyModal: (show) => set({ showApiKeyModal: show }),
      setEmbeddingsEnabled: (enabled) => set({ embeddingsEnabled: enabled }),
      setJudgeEnabled: (enabled) => set({ judgeEnabled: enabled }),
      setInvariantEntailmentEnabled: (enabled) => set({ invariantEntailmentEnabled: enabled }),
      setConsistencyCheckMode: (mode) => set({ consistencyCheckMode: normalizeConsistencyCheckMode(mode) }),
      setTelemetryEnabled: (enabled) => set({ telemetryEnabled: enabled }),
      setGraphEnrichment: (setting) => set({ graphEnrichment: setting }),
      hasKeys: () => {
        const s = get()
        // Ollama runs locally — no API key needed
        if (s.llmConfig.provider === 'ollama') return true
        return s.llmConfig.apiKey.length > 0
      },
    }),
    {
      name: 'intent-ide-settings',
      onRehydrateStorage: () => (state) => {
        // Unknown persisted provider (renamed/retired id) → reset provider AND
        // model to the Claude defaults — never silently a pricier model.
        if (state && !VALID_PROVIDERS.has(state.llmConfig.provider)) {
          state.setLLMConfig({
            provider: 'claude',
            model: PROVIDER_DEFAULT_MODEL.claude,
          })
        }
        // Migrate stale Claude model IDs persisted by older builds.
        if (state && state.llmConfig.provider === 'claude') {
          const normalized = normalizeClaudeModel(state.llmConfig.model)
          if (normalized !== state.llmConfig.model) {
            state.setLLMConfig({ model: normalized })
          }
        }
        // Backfill toggles missing from older persisted snapshots (default on).
        if (state && typeof (state as { embeddingsEnabled?: unknown }).embeddingsEnabled !== 'boolean') {
          state.setEmbeddingsEnabled(true)
        }
        if (state && typeof (state as { judgeEnabled?: unknown }).judgeEnabled !== 'boolean') {
          state.setJudgeEnabled(true)
        }
        // A snapshot from before the mode existed has none; normalize rather
        // than leave it undefined, which would read as neither 'commit' nor
        // 'off' at every call site.
        if (state) {
          state.setConsistencyCheckMode(
            normalizeConsistencyCheckMode((state as { consistencyCheckMode?: unknown }).consistencyCheckMode),
          )
        }
        // Snapshots written before the native-Ollama dialect carry no context
        // size. Backfilling the raised default (rather than leaving it unset)
        // is the point of the fix — an existing local user must not stay
        // silently pinned to Ollama's 4096.
        if (state && typeof state.llmConfig.contextTokens !== 'number') {
          state.setContextTokens(DEFAULT_OLLAMA_CONTEXT_TOKENS)
        }
        // Privacy-sensitive: anything other than an explicit stored `true`
        // resolves to OFF. Same rule for the entailment lane, which is the
        // only doc-CI path that spends money and sends document text.
        if (state && typeof (state as { telemetryEnabled?: unknown }).telemetryEnabled !== 'boolean') {
          state.setTelemetryEnabled(false)
        }
        if (
          state &&
          typeof (state as { invariantEntailmentEnabled?: unknown }).invariantEntailmentEnabled !==
            'boolean'
        ) {
          state.setInvariantEntailmentEnabled(false)
        }
        // Snapshots written before this field existed (or carrying a retired
        // value) backfill to the default 'local-only' — never silently
        // upgraded to 'always' (which would newly opt a snapshot into sending
        // block text to a hosted API on idle).
        if (
          state &&
          !VALID_GRAPH_ENRICHMENT_SETTINGS.has(
            (state as { graphEnrichment?: unknown }).graphEnrichment as string,
          )
        ) {
          state.setGraphEnrichment('local-only')
        }
      },
    }
  )
)
