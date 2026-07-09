'use client'

import { useEffect, useState } from 'react'
import {
  useSettingsStore,
  type LLMProvider,
  PROVIDER_MODELS,
  PROVIDER_DEFAULT_MODEL,
  PROVIDER_BASE_URLS,
} from '@/stores/settingsStore'
import { modelRejectsSampling } from '@/lib/ai/modelCapabilities'
import { getSessionEstimate } from '@/lib/ai/spendEstimate'
import { useCascadeCalibrationStore } from '@/stores/cascadeCalibrationStore'

export function ApiKeyModal() {
  const llmConfig = useSettingsStore((s) => s.llmConfig)
  const whisperKey = useSettingsStore((s) => s.whisperApiKey)
  const setLLMConfig = useSettingsStore((s) => s.setLLMConfig)
  const setWhisperKey = useSettingsStore((s) => s.setWhisperKey)
  const setShow = useSettingsStore((s) => s.setShowApiKeyModal)
  const judgeEnabled = useSettingsStore((s) => s.judgeEnabled)
  const setJudgeEnabled = useSettingsStore((s) => s.setJudgeEnabled)
  const embeddingsEnabled = useSettingsStore((s) => s.embeddingsEnabled)
  const setEmbeddingsEnabled = useSettingsStore((s) => s.setEmbeddingsEnabled)
  const telemetryEnabled = useSettingsStore((s) => s.telemetryEnabled)
  const setTelemetryEnabled = useSettingsStore((s) => s.setTelemetryEnabled)
  const calibrationCounts = useCascadeCalibrationStore((s) => s.counts)
  const resetCalibration = useCascadeCalibrationStore((s) => s.reset)

  // Local calibration readout: explicit review decisions only (accepted vs
  // accepted + rejected) — 'applied' is a downstream consequence, not a
  // per-proposal verdict.
  const calibrationRatio = (severity: 'must' | 'probably' | 'optional') => {
    const row = calibrationCounts[severity]
    return { accepted: row.accepted, total: row.accepted + row.rejected }
  }
  const mustRatio = calibrationRatio('must')
  const likelyRatio = calibrationRatio('probably')
  const optionalRatio = calibrationRatio('optional')
  const mustMiscalibrated = mustRatio.total > 0 && mustRatio.accepted / mustRatio.total < 0.7

  const [provider, setProvider] = useState<LLMProvider>(llmConfig.provider)
  const [apiKey, setApiKey] = useState(llmConfig.apiKey)
  const [model, setModel] = useState(llmConfig.model)
  const [customModel, setCustomModel] = useState('')
  const [baseUrl, setBaseUrl] = useState(llmConfig.baseUrl ?? PROVIDER_BASE_URLS[llmConfig.provider] ?? '')
  const [wKey, setWKey] = useState(whisperKey)
  // Spend estimate is module state, not reactive — poll it while the modal is
  // open so long-lived sessions see the line move without reopening.
  const [sessionTokens, setSessionTokens] = useState(() => getSessionEstimate())
  useEffect(() => {
    const timer = setInterval(() => setSessionTokens(getSessionEstimate()), 2000)
    return () => clearInterval(timer)
  }, [])

  const handleProviderChange = (p: LLMProvider) => {
    setProvider(p)
    setModel(PROVIDER_DEFAULT_MODEL[p])
    setBaseUrl(PROVIDER_BASE_URLS[p] ?? '')
    setCustomModel('')
  }

  const presetModels = PROVIDER_MODELS[provider]
  const isCustomModel = customModel.length > 0 || !presetModels.some((m) => m.value === model)
  const effectiveModel = customModel || model

  const handleSave = () => {
    setLLMConfig({
      provider,
      apiKey: provider === 'ollama' ? '' : apiKey,
      model: effectiveModel,
      baseUrl: baseUrl || undefined,
    })
    if (provider !== 'ollama') {
      setWhisperKey(wKey || apiKey)
    }
    setShow(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-serif text-xl">API Configuration</h2>
          <button onClick={() => setShow(false)} className="text-muted hover:text-ink text-xl leading-none">&times;</button>
        </div>

        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Provider */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1.5">Provider</label>
            <div className="grid grid-cols-3 gap-2">
              {(['claude', 'openai', 'ollama'] as LLMProvider[]).map((p) => (
                <button
                  key={p}
                  onClick={() => handleProviderChange(p)}
                  className={`py-2 px-3 text-sm font-medium rounded-lg border transition-colors ${
                    provider === p
                      ? 'border-accent bg-accent/5 text-accent'
                      : 'border-border text-muted hover:text-ink hover:border-ink/30'
                  }`}
                >
                  {p === 'claude' ? 'Claude' : p === 'openai' ? 'OpenAI' : 'Ollama'}
                </button>
              ))}
            </div>
            {provider === 'ollama' && (
              <p className="mt-2 text-xs text-annotation-correction">
                Ollama runs locally — no API key required. Make sure Ollama is running.
              </p>
            )}
          </div>

          {/* API Key — hidden for Ollama */}
          {provider !== 'ollama' && (
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1.5">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={provider === 'claude' ? 'sk-ant-api03-...' : 'sk-proj-...'}
                className="w-full px-3 py-2 text-sm font-mono border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
              />
            </div>
          )}

          {/* Model selection */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1.5">Model</label>
            <select
              value={isCustomModel ? '__custom__' : model}
              onChange={(e) => {
                if (e.target.value === '__custom__') {
                  setCustomModel(model)
                } else {
                  setModel(e.target.value)
                  setCustomModel('')
                }
              }}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20"
            >
              {presetModels.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
              <option value="__custom__">Custom model name...</option>
            </select>
            {(isCustomModel || customModel) && (
              <input
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="e.g. llama3.2:latest"
                className="mt-2 w-full px-3 py-2 text-sm font-mono border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            )}
            {provider === 'claude' && /opus|fable/i.test(effectiveModel) && (
              <p className="mt-2 text-xs text-annotation-correction">
                Each annotation can dispatch 3+ model calls (multi-agent review).
                Opus/Fable cost significantly more per token than Sonnet 4.6.
              </p>
            )}
            {provider === 'claude' && modelRejectsSampling(effectiveModel) && (
              <p className="mt-1 text-xs text-muted">
                This model ignores <code>temperature</code>, so the multi-agent
                debate&apos;s diversity tuning is disabled.
              </p>
            )}
          </div>

          {/* Base URL — shown for Ollama or custom */}
          {(provider === 'ollama' || baseUrl) && (
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1.5">
                Base URL {provider === 'ollama' ? '' : '(optional)'}
              </label>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://localhost:11434"
                className="w-full px-3 py-2 text-sm font-mono border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
          )}

          {/* Whisper key — hidden for Ollama */}
          {provider !== 'ollama' && (
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1.5">
                Whisper Key <span className="normal-case font-sans text-muted/70">(voice transcription, defaults to above key)</span>
              </label>
              <input
                type="password"
                value={wKey}
                onChange={(e) => setWKey(e.target.value)}
                placeholder="Leave empty to use the key above"
                className="w-full px-3 py-2 text-sm font-mono border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
              <p className="mt-1 text-xs text-muted">Whisper requires an OpenAI API key regardless of your LLM provider.</p>
            </div>
          )}

          {/* AI data & spend */}
          <div className="pt-4 border-t border-border space-y-3">
            <h3 className="text-xs font-mono uppercase tracking-wider text-muted">AI data &amp; spend</h3>

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={judgeEnabled}
                onChange={(e) => setJudgeEnabled(e.target.checked)}
                className="mt-0.5 accent-ink"
              />
              <span className="text-sm text-ink leading-snug">
                Verify must-severity citations
                <span className="block text-xs text-muted">
                  Extra small model call that double-checks each cited conflict before it is
                  marked &ldquo;must change&rdquo;.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={embeddingsEnabled}
                onChange={(e) => setEmbeddingsEnabled(e.target.checked)}
                className="mt-0.5 accent-ink"
              />
              <span className="text-sm text-ink leading-snug">
                Semantic similarity edges (embeddings)
                <span className="block text-xs text-muted">
                  Finds paraphrased duplicates across sections. Requires a provider with an
                  embeddings API (OpenAI or Ollama).
                </span>
              </span>
            </label>

            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1.5">
                Embedding model <span className="normal-case font-sans text-muted/70">(optional override)</span>
              </label>
              <input
                value={llmConfig.embedModel ?? ''}
                onChange={(e) => setLLMConfig({ embedModel: e.target.value || undefined })}
                placeholder="Default: text-embedding-3-small (OpenAI) / nomic-embed-text (Ollama)"
                className="w-full px-3 py-2 text-sm font-mono border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={telemetryEnabled}
                onChange={(e) => setTelemetryEnabled(e.target.checked)}
                className="mt-0.5 accent-ink"
              />
              <span className="text-sm text-ink leading-snug">
                Share anonymous review stats (no document content)
                <span className="block text-xs text-muted">
                  Sends only severity and accept/reject counts for cascade proposals —
                  never document text or identifiers. Off by default.
                </span>
              </span>
            </label>

            {/* Local severity-calibration readout — always local, never sent. */}
            <div className="rounded-lg border border-border bg-warm/40 px-3 py-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-mono text-muted">
                  Must accepted: {mustRatio.accepted}/{mustRatio.total}
                  {' '}&middot; Likely: {likelyRatio.accepted}/{likelyRatio.total}
                  {' '}&middot; Optional: {optionalRatio.accepted}/{optionalRatio.total}
                </p>
                <button
                  onClick={resetCalibration}
                  className="text-xs text-muted hover:text-ink underline underline-offset-2 shrink-0"
                  title="Reset the local cascade review statistics"
                >
                  Reset
                </button>
              </div>
              {mustMiscalibrated && (
                <p className="text-xs text-annotation-correction">
                  Verification may be miscalibrated &mdash; you reject most
                  &ldquo;must change&rdquo; proposals.
                </p>
              )}
            </div>

            <p className="text-xs text-muted leading-relaxed">
              Document text leaves this machine only when you act: on annotation resolution,
              cascade analysis, citation verification, and semantic-similarity indexing — never
              while typing. All calls go only to your configured provider.
            </p>

            <p className="text-xs font-mono text-muted">
              This session: ~{sessionTokens.toLocaleString()} tokens sent (rough estimate; excludes transcription)
            </p>
          </div>

          <button
            onClick={handleSave}
            className="w-full px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/80 transition-colors"
          >
            Save
          </button>

          <p className="text-xs text-muted text-center">
            Keys are stored locally in your browser. Never sent to our servers.
          </p>
        </div>
      </div>
    </div>
  )
}
