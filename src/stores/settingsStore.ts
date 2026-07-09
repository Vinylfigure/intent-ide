'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type LLMProvider = 'claude' | 'openai' | 'ollama'

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
}

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
  ollama: [
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
  ollama: 'llama3.2',
}

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
  ollama: 'http://localhost:11434',
}

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
   * Anonymous severity-calibration telemetry (default OFF — public repo,
   * other users). When on, cascade accept/reject decisions send metadata-only
   * events (severity × action, never document content or ids) to PostHog if
   * one is wired. The local calibration aggregate records regardless — it
   * never leaves the machine.
   */
  telemetryEnabled: boolean
  setLLMConfig: (config: Partial<LLMConfig>) => void
  setWhisperKey: (key: string) => void
  setShowApiKeyModal: (show: boolean) => void
  setEmbeddingsEnabled: (enabled: boolean) => void
  setJudgeEnabled: (enabled: boolean) => void
  setTelemetryEnabled: (enabled: boolean) => void
  hasKeys: () => boolean
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      llmConfig: {
        provider: 'claude',
        apiKey: '',
        model: 'claude-sonnet-4-6',
        baseUrl: undefined,
      },
      whisperApiKey: '',
      showApiKeyModal: false,
      embeddingsEnabled: true,
      judgeEnabled: true,
      telemetryEnabled: false,
      setLLMConfig: (config) =>
        set((s) => ({ llmConfig: { ...s.llmConfig, ...config } })),
      setWhisperKey: (key) => set({ whisperApiKey: key }),
      setShowApiKeyModal: (show) => set({ showApiKeyModal: show }),
      setEmbeddingsEnabled: (enabled) => set({ embeddingsEnabled: enabled }),
      setJudgeEnabled: (enabled) => set({ judgeEnabled: enabled }),
      setTelemetryEnabled: (enabled) => set({ telemetryEnabled: enabled }),
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
        // Privacy-sensitive: anything other than an explicit stored `true`
        // resolves to OFF.
        if (state && typeof (state as { telemetryEnabled?: unknown }).telemetryEnabled !== 'boolean') {
          state.setTelemetryEnabled(false)
        }
      },
    }
  )
)
