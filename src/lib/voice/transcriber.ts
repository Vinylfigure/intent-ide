import { useSettingsStore } from '@/stores/settingsStore'
import { addTranscriptionEstimate } from '@/lib/ai/spendEstimate'

export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const whisperKey = useSettingsStore.getState().whisperApiKey
  const llmKey = useSettingsStore.getState().llmConfig.apiKey

  // Use whisper key if set, otherwise fall back to LLM key (OpenAI key works for both)
  const apiKey = whisperKey || llmKey

  if (!apiKey) {
    throw new Error('No API key configured for transcription')
  }

  const formData = new FormData()
  formData.append('file', audioBlob, 'recording.webm')
  formData.append('model', 'whisper-1')

  // Soft spend indicator (display only) — tracked separately from the
  // char-based token estimate; see spendEstimate.ts.
  addTranscriptionEstimate(audioBlob.size)

  const response = await fetch('/api/transcribe', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
    },
    body: formData,
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Transcription failed: ${error}`)
  }

  const data = await response.json()
  return data.text
}
