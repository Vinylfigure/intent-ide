'use client'

import { useEffect, useState } from 'react'
import { startVoiceCapture, stopVoiceCaptureForTranscript } from '@/lib/voice/pipeline'
import { useVoiceStore } from '@/stores/voiceStore'
import type { AnnotationType } from '@/lib/annotations/types'
import { ANNOTATION_COLORS } from '@/lib/annotations/types'

type SuggestedIntent = Exclude<AnnotationType, 'flag'>

interface AnnotationComposerProps {
  initialText?: string
  selectionAnchor?: { from: number; to: number; text?: string }
  parentAnnotationId?: string | null
  suggestedIntent?: SuggestedIntent | null
  mode: 'selection' | 'thread' | 'inline'
  onSubmit: (payload: { text: string; suggestedIntent: AnnotationType | null }) => Promise<void> | void
  onCancel?: () => void
  className?: string
}

const QUICK_ACTIONS: Array<{ label: string; value: SuggestedIntent }> = [
  { label: 'Dig deeper', value: 'dig' },
  { label: "What's this mean?", value: 'ask' },
  { label: 'Edit this', value: 'edit' },
]

export function AnnotationComposer({
  initialText = '',
  suggestedIntent = null,
  mode,
  onSubmit,
  onCancel,
  className = '',
}: AnnotationComposerProps) {
  const isRecording = useVoiceStore((s) => s.isRecording)
  const voiceError = useVoiceStore((s) => s.error)
  const [value, setValue] = useState(initialText)
  const [activeIntent, setActiveIntent] = useState<SuggestedIntent | null>(suggestedIntent)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    setValue(initialText)
  }, [initialText])

  useEffect(() => {
    setActiveIntent(suggestedIntent)
  }, [suggestedIntent])

  const handleVoiceToggle = async () => {
    if (isRecording) {
      try {
        const transcript = await stopVoiceCaptureForTranscript()
        setValue((prev) => prev ? `${prev} ${transcript}`.trim() : transcript)
      } catch {
        // Voice store already captures the error.
      }
      return
    }

    await startVoiceCapture()
  }

  const handleSubmit = async () => {
    const text = value.trim()
    if (!text) return
    setIsSubmitting(true)
    try {
      await onSubmit({ text, suggestedIntent: activeIntent })
      setValue('')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className={`rounded-xl border border-border bg-white shadow-lg ${className}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' && value.trim()) {
              e.preventDefault()
              handleSubmit()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              onCancel?.()
            }
          }}
          placeholder={mode === 'selection' ? "What's on your mind?" : 'Add a note or follow-up'}
          className="flex-1 text-sm bg-transparent border-none focus:outline-none placeholder:text-muted-foreground/60"
          autoFocus
        />

        <button
          onClick={handleVoiceToggle}
          title={isRecording ? 'Stop recording' : 'Voice input'}
          className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors shrink-0 ${
            isRecording
              ? 'bg-red-500 text-white animate-pulse'
              : 'text-muted-foreground hover:text-ink hover:bg-warm'
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>
        <button
          onClick={handleSubmit}
          disabled={!value.trim() || isSubmitting}
          title="Submit"
          className="w-8 h-8 flex items-center justify-center rounded-full text-white bg-accent hover:bg-accent/80 transition-colors shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>

      <div className="flex flex-wrap gap-1 px-3 pb-2">
        {QUICK_ACTIONS.map((action) => {
          const isActive = activeIntent === action.value
          return (
            <button
              key={action.value}
              onClick={() => setActiveIntent((prev) => prev === action.value ? null : action.value)}
              className="px-2 py-1 text-[10px] font-mono rounded-full border transition-colors"
              style={{
                borderColor: isActive ? ANNOTATION_COLORS[action.value] : 'rgba(140,130,120,0.35)',
                color: isActive ? ANNOTATION_COLORS[action.value] : undefined,
                backgroundColor: isActive ? `${ANNOTATION_COLORS[action.value]}14` : undefined,
              }}
            >
              {action.label}
            </button>
          )
        })}

        {onCancel && (
          <button
            onClick={onCancel}
            className="ml-auto px-2 py-1 text-[10px] font-mono text-muted-foreground hover:text-ink transition-colors"
          >
            Cancel
          </button>
        )}
      </div>

      {voiceError && (
        <p className="px-3 pb-3 text-xs text-red-500">
          {voiceError}
        </p>
      )}
    </div>
  )
}
