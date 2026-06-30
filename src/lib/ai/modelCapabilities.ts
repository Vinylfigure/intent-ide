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
