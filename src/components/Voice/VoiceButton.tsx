'use client'

import { useVoiceStore } from '@/stores/voiceStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { toggleVoiceCapture } from '@/lib/voice/pipeline'

export function VoiceButton() {
  const isRecording = useVoiceStore((s) => s.isRecording)
  const isTranscribing = useVoiceStore((s) => s.isTranscribing)
  const hasKeys = useSettingsStore((s) => s.llmConfig.apiKey.length > 0)

  const handleClick = () => {
    if (!hasKeys) {
      useSettingsStore.getState().setShowApiKeyModal(true)
      return
    }
    toggleVoiceCapture()
  }

  return (
    <button
      onClick={handleClick}
      className={`fixed bottom-12 right-6 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all z-50 ${
        isRecording
          ? 'bg-accent text-white animate-pulse scale-110'
          : isTranscribing
          ? 'bg-annotation-question text-white'
          : 'bg-ink text-white hover:bg-ink/80'
      }`}
      title={isRecording ? 'Stop recording (Ctrl+Space)' : 'Start recording (Ctrl+Space)'}
    >
      {isRecording ? (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
        </svg>
      ) : isTranscribing ? (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
          <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" />
        </svg>
      ) : (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      )}
    </button>
  )
}
