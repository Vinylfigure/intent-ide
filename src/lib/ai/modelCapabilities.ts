// Model capability helpers.
//
// Newer Anthropic frontier models (Opus 4.7, Opus 4.8, Fable 5, Mythos) removed
// the sampling parameters — sending `temperature`/`top_p` to them returns a 400.
// Opus 4.6, Sonnet 4.6, and Haiku 4.5 still accept `temperature`, so the gate is
// model-specific rather than provider-wide. This only applies to the Claude
// provider; OpenAI/Ollama models keep their sampling params.

/**
 * True when the given Claude model rejects sampling params (`temperature`,
 * `top_p`, `top_k`) with a 400. Callers must omit those fields for these models.
 */
export function modelRejectsSampling(model: string): boolean {
  const m = (model || '').toLowerCase()
  return (
    m.includes('opus-4-7') ||
    m.includes('opus-4-8') ||
    m.includes('fable-5') ||
    m.includes('mythos')
  )
}

/**
 * The model to use for utility calls (context compaction, graph extraction,
 * relevance judging) — housekeeping that should never run at Opus/Fable
 * prices. On the Claude provider this pins the cheapest capable model; other
 * providers (OpenAI/Ollama) keep the user's selected model since we can't
 * assume a cheaper sibling exists.
 */
export function pickUtilityModel(config: { provider: string; model: string }): string {
  return config.provider === 'claude' ? 'claude-haiku-4-5' : config.model
}
