'use client'

import { useState } from 'react'
import {
  useSettingsStore,
  type LLMProvider,
  PROVIDER_MODELS,
  PROVIDER_DEFAULT_MODEL,
  PROVIDER_BASE_URLS,
} from '@/stores/settingsStore'
import { modelRejectsSampling } from '@/lib/ai/modelCapabilities'

export function ApiKeyModal() {
  const llmConfig = useSettingsStore((s) => s.llmConfig)
  const whisperKey = useSettingsStore((s) => s.whisperApiKey)
  const setLLMConfig = useSettingsStore((s) => s.setLLMConfig)
  const setWhisperKey = useSettingsStore((s) => s.setWhisperKey)
  const setShow = useSettingsStore((s) => s.setShowApiKeyModal)

  const [provider, setProvider] = useState<LLMProvider>(llmConfig.provider)
  const [apiKey, setApiKey] = useState(llmConfig.apiKey)
  const [model, setModel] = useState(llmConfig.model)
  const [customModel, setCustomModel] = useState('')
  const [baseUrl, setBaseUrl] = useState(llmConfig.baseUrl ?? PROVIDER_BASE_URLS[llmConfig.provider] ?? '')
  const [wKey, setWKey] = useState(whisperKey)

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

        <div className="p-6 space-y-4">
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
