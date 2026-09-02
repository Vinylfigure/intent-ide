import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { transcribeAudio } from '../transcriber'
import { useSettingsStore } from '@/stores/settingsStore'
import { getTranscriptionEstimate, getSessionEstimate, resetSessionEstimate } from '@/lib/ai/spendEstimate'

beforeEach(() => {
  resetSessionEstimate()
  useSettingsStore.setState({ whisperApiKey: 'sk-test' })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ text: 'transcribed text' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('transcribeAudio spend accounting', () => {
  it('records the audio blob size on a successful call, separately from the token estimate', async () => {
    const blob = new Blob(['x'.repeat(1000)], { type: 'audio/webm' })
    await transcribeAudio(blob)
    expect(getTranscriptionEstimate()).toBe(blob.size)
    expect(getSessionEstimate()).toBe(0)
  })

  it('accumulates across multiple calls', async () => {
    const blob = new Blob(['x'.repeat(500)], { type: 'audio/webm' })
    await transcribeAudio(blob)
    await transcribeAudio(blob)
    expect(getTranscriptionEstimate()).toBe(blob.size * 2)
  })
})
