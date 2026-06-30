'use client'

import { useVoiceStore } from '@/stores/voiceStore'

export function VoiceOverlay() {
  const isRecording = useVoiceStore((s) => s.isRecording)
  const transcript = useVoiceStore((s) => s.transcript)
  const error = useVoiceStore((s) => s.error)

  if (!isRecording && !error) return null

  return (
    <div className="fixed inset-x-0 bottom-28 flex justify-center z-40 pointer-events-none">
      <div className="bg-ink/90 text-white px-6 py-3 rounded-xl shadow-xl backdrop-blur-sm max-w-md text-center pointer-events-auto">
        {error ? (
          <p className="text-accent text-sm">{error}</p>
        ) : (
          <>
            <div className="flex items-center justify-center gap-2 mb-1">
              <div className="w-2 h-2 bg-accent rounded-full animate-pulse" />
              <span className="text-sm font-medium">Recording...</span>
            </div>
            <p className="text-xs text-white/60">Press Ctrl+Space or click the button to stop</p>
          </>
        )}
      </div>
    </div>
  )
}
