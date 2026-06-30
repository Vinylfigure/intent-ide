'use client'

import { create } from 'zustand'
import type { AnnotationType, Scope } from '@/lib/annotations/types'

export interface PendingAnnotation {
  transcript: string
  from: number
  to: number
  scope: Scope
  text: string
  suggestedType: AnnotationType
}

interface VoiceState {
  isRecording: boolean
  isTranscribing: boolean
  transcript: string | null
  error: string | null
  pendingAnnotation: PendingAnnotation | null
  setRecording: (recording: boolean) => void
  setTranscribing: (transcribing: boolean) => void
  setTranscript: (transcript: string | null) => void
  setError: (error: string | null) => void
  setPendingAnnotation: (pending: VoiceState['pendingAnnotation']) => void
  clearPendingAnnotation: () => void
  reset: () => void
}

export const useVoiceStore = create<VoiceState>()((set) => ({
  isRecording: false,
  isTranscribing: false,
  transcript: null,
  error: null,
  pendingAnnotation: null,
  setRecording: (recording) => set({ isRecording: recording }),
  setTranscribing: (transcribing) => set({ isTranscribing: transcribing }),
  setTranscript: (transcript) => set({ transcript }),
  setError: (error) => set({ error }),
  setPendingAnnotation: (pending) => set({ pendingAnnotation: pending }),
  clearPendingAnnotation: () => set({ pendingAnnotation: null }),
  reset: () =>
    set({
      isRecording: false,
      isTranscribing: false,
      transcript: null,
      error: null,
      pendingAnnotation: null,
    }),
}))
