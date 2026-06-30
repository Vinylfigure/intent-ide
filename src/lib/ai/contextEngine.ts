import { callLLM } from './client'
import { CONTEXT_COMPRESSION_PROMPT } from './prompts'
import { useSettingsStore } from '@/stores/settingsStore'
import { useSessionStore, type SessionContext } from '@/stores/sessionStore'

// Estimate tokens (rough: 1 token ≈ 4 chars)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export async function compressSessionContext(): Promise<void> {
  const sessionStore = useSessionStore.getState()
  const config = useSettingsStore.getState().llmConfig
  const history = sessionStore.context.annotationHistory

  if (!history || estimateTokens(history) < 400) return

  try {
    const prompt = CONTEXT_COMPRESSION_PROMPT.replace('{{history}}', history)

    const compressed = await callLLM(
      [{ role: 'user', content: prompt }],
      config,
      { maxTokens: 300, temperature: 0 },
    )

    sessionStore.updateContext({
      annotationHistory: compressed,
      totalTokens: estimateTokens(compressed),
    })
  } catch (err) {
    console.error('Context compression failed:', err)
    // Keep existing context on failure
  }
}

// Called after each annotation resolution
export async function updateSessionContext(annotation: {
  type: string
  transcript: string
  anchorText: string
}): Promise<void> {
  const sessionStore = useSessionStore.getState()

  // Append a one-line summary
  const entry = `[${annotation.type}] "${annotation.transcript}" on "${annotation.anchorText.slice(0, 50)}..."`
  sessionStore.appendToHistory(entry)

  // Compress every 5 annotations
  const lineCount = (sessionStore.context.annotationHistory.match(/\n/g) || []).length + 1
  if (lineCount >= 5 && lineCount % 5 === 0) {
    await compressSessionContext()
  }
}
