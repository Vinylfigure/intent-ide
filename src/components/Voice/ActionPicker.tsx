'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ANNOTATION_COLORS, ANNOTATION_LABELS } from '@/lib/annotations/types'
import type { AnnotationType } from '@/lib/annotations/types'
import { confirmAnnotation } from '@/lib/voice/pipeline'
import { useVoiceStore } from '@/stores/voiceStore'

const ANNOTATION_TYPES: AnnotationType[] = ['ask', 'edit', 'dig', 'flag']

const AUTO_CONFIRM_SECONDS = 3

export function ActionPicker() {
  const pendingAnnotation = useVoiceStore((s) => s.pendingAnnotation)
  const clearPendingAnnotation = useVoiceStore((s) => s.clearPendingAnnotation)

  const [selectedType, setSelectedType] = useState<AnnotationType | null>(null)
  const [countdown, setCountdown] = useState(AUTO_CONFIRM_SECONDS)
  const interactedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Reset state when a new pending annotation appears
  useEffect(() => {
    if (pendingAnnotation) {
      setSelectedType(pendingAnnotation.suggestedType as AnnotationType)
      setCountdown(AUTO_CONFIRM_SECONDS)
      interactedRef.current = false
    }
  }, [pendingAnnotation])

  // Auto-confirm countdown
  useEffect(() => {
    if (!pendingAnnotation) return

    timerRef.current = setInterval(() => {
      if (interactedRef.current) return

      setCountdown((prev) => {
        if (prev <= 1) {
          const type = selectedType ?? (pendingAnnotation.suggestedType as AnnotationType)
          confirmAnnotation(type)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [pendingAnnotation, selectedType])

  const handleInteraction = useCallback(() => {
    interactedRef.current = true
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const handleSelectType = useCallback(
    (type: AnnotationType) => {
      handleInteraction()
      setSelectedType(type)
    },
    [handleInteraction],
  )

  const handleConfirm = useCallback(() => {
    if (!pendingAnnotation || !selectedType) return
    confirmAnnotation(selectedType)
  }, [pendingAnnotation, selectedType])

  const handleDismiss = useCallback(() => {
    handleInteraction()
    clearPendingAnnotation()
  }, [handleInteraction, clearPendingAnnotation])

  if (!pendingAnnotation) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div
        className="relative bg-ink/95 text-white rounded-2xl shadow-2xl backdrop-blur-md p-6 w-80 pointer-events-auto"
        onClick={handleInteraction}
      >
        {/* Dismiss button */}
        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-colors text-sm"
          aria-label="Dismiss"
        >
          x
        </button>

        {/* Transcript */}
        <p className="text-sm text-white/80 mb-4 pr-6 leading-relaxed line-clamp-3">
          &ldquo;{pendingAnnotation.transcript}&rdquo;
        </p>

        {/* Type grid */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {ANNOTATION_TYPES.map((type) => {
            const isSelected = selectedType === type
            const color = ANNOTATION_COLORS[type]

            return (
              <button
                key={type}
                onClick={() => handleSelectType(type)}
                className="px-3 py-2 rounded-lg text-sm font-medium transition-all border-2"
                style={{
                  borderColor: isSelected ? color : 'transparent',
                  backgroundColor: isSelected ? `${color}20` : 'rgba(255,255,255,0.05)',
                  color: isSelected ? color : 'rgba(255,255,255,0.7)',
                }}
              >
                {ANNOTATION_LABELS[type]}
              </button>
            )
          })}
        </div>

        {/* Confirm button */}
        <button
          onClick={handleConfirm}
          className="w-full py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
        >
          Confirm
          {!interactedRef.current && countdown > 0 && (
            <span className="ml-2 text-white/60">({countdown}s)</span>
          )}
        </button>
      </div>
    </div>
  )
}
