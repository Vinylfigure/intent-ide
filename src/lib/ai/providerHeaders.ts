import type { LLMConfig } from '@/stores/settingsStore'

/**
 * The BYOK header block sent to every /api/* LLM proxy route:
 * x-api-key / x-provider / x-model, plus x-base-url only when the config has
 * one — same conditional semantics as the historical inline spreads.
 * Content-Type stays at the call sites (it is not a provider header).
 */
export function providerHeaders(config: LLMConfig): Record<string, string> {
  return {
    'x-api-key': config.apiKey,
    'x-provider': config.provider,
    'x-model': config.model,
    ...(config.baseUrl ? { 'x-base-url': config.baseUrl } : {}),
  }
}
