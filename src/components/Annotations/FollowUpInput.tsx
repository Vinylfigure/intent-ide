'use client'

import { useState, useRef } from 'react'
import { AudioRecorder } from '@/lib/voice/recorder'
import { transcribeAudio } from '@/lib/voice/transcriber'
import type { Annotation } from '@/lib/annotations/types'

interface FollowUpInputProps {
  annotation: Annotation
  onSend: (text: string) => void
  disabled?: boolean
}

export function FollowUpInput({ annotation, onSend, disabled }: FollowUpInputProps) {
  const [text, setText] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const recorderRef = useRef<AudioRecorder | null>(null)

  const handleSend = () => {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setText('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleMicClick = async () => {
    try {
      if (!isRecording) {
        if (!recorderRef.current) {
          recorderRef.current = new AudioRecorder()
        }
        await recorderRef.current.start()
        setIsRecording(true)
      } else {
        if (!recorderRef.current) return
        const audioBlob = await recorderRef.current.stop()
        setIsRecording(false)
        setIsTranscribing(true)
        try {
          const transcription = await transcribeAudio(audioBlob)
          setText((prev) => (prev ? prev + ' ' + transcription : transcription))
        } finally {
          setIsTranscribing(false)
        }
      }
    } catch (err) {
      console.error('Voice input error:', err)
      setIsRecording(false)
      setIsTranscribing(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 relative">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Follow up..."
          disabled={disabled}
          className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:ring-2 focus:ring-accent/20 focus:outline-none disabled:opacity-50"
        />
        {disabled && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-3 h-3 border-2 border-muted/30 border-t-muted rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Send button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          handleSend()
        }}
        disabled={!text.trim() || disabled}
        className="p-2 rounded-lg text-muted hover:text-ink hover:bg-warm transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        title="Send"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M14 2L7 9M14 2L9.5 14L7 9M14 2L2 6.5L7 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Mic button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          handleMicClick()
        }}
        disabled={disabled || isTranscribing}
        className={`p-2 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
          isRecording
            ? 'text-red-500 bg-red-50 hover:bg-red-100'
            : 'text-muted hover:text-ink hover:bg-warm'
        }`}
        title={isRecording ? 'Stop recording' : isTranscribing ? 'Transcribing...' : 'Voice input'}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="5.5" y="1" width="5" height="9" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 7.5C3 10.26 5.24 12.5 8 12.5C10.76 12.5 13 10.26 13 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M8 12.5V15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
