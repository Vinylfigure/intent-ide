'use client'

import { useVoiceStore } from '@/stores/voiceStore'

export function TranscriptPreview() {
  const transcript = useVoiceStore((s) => s.transcript)
  const isTranscribing = useVoiceStore((s) => s.isTranscribing)

  if (!transcript && !isTranscribing) return null

  return (
    <div className="px-4 py-2 bg-warm border-b border-border text-sm">
      {isTranscribing ? (
        <span className="text-muted italic">Transcribing...</span>
      ) : (
        <span className="text-ink">{transcript}</span>
      )}
    </div>
  )
}
