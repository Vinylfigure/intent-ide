'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { startVoiceCapture, stopVoiceCaptureForTranscript } from '@/lib/voice/pipeline'
import { useVoiceStore } from '@/stores/voiceStore'
import type { AnnotationType, Scope } from '@/lib/annotations/types'
import { ANNOTATION_COLORS } from '@/lib/annotations/types'
import {
  DEFAULT_OFFERS,
  deriveOffers,
  inferScopeFromText,
  type Offer,
  type OfferContext,
} from '@/lib/annotations/selectionOffers'

type SuggestedIntent = Exclude<AnnotationType, 'flag'>

interface AnnotationComposerProps {
  initialText?: string
  /**
   * What the human actually pointed at. Drives the offered actions: a figure,
   * a heading and a paragraph are different kinds of thing and afford
   * different questions. Absent (voice capture, programmatic open) falls back
   * to the generic three.
   */
  selectionAnchor?: { from: number; to: number; text?: string; scope?: Scope; nodeType?: string }
  /** Graph/ledger signals that sharpen the offers. Cheap, synchronous, optional. */
  offerContext?: OfferContext
  suggestedIntent?: SuggestedIntent | null
  mode: 'selection' | 'thread' | 'inline'
  onSubmit: (payload: {
    text: string
    suggestedIntent: AnnotationType | null
    /** One-click actions preset the intent — skip the LLM classify round-trip. */
    skipClassify?: boolean
  }) => Promise<void> | void
  onCancel?: () => void
  className?: string
  /**
   * Focus the input on mount, and again whenever this flips true.
   *
   * Default true for the thread/inline composers, which the reader opened by
   * clicking — focusing there is what they asked for. The SELECTION composer
   * passes false: an autofocused input steals the document selection the moment
   * a highlight finishes, which is what made Cmd+C copy nothing. It focuses
   * later, on the first typed character.
   */
  autoFocus?: boolean
  /** When given, renders a Copy chip first in the offers row. */
  onCopy?: () => void
  /** When the selection is a link, renders an Open-link chip beside Copy. */
  onOpenLink?: () => void
}

/**
 * One-click actions: a single tap submits a canned prompt with a preset
 * intent (skipClassify) — no typing required. Typed text keeps the classic
 * classify flow. The set itself is derived from the selection's shape by
 * `deriveOffers`; this component only renders and dispatches them.
 */
export function AnnotationComposer({
  initialText = '',
  selectionAnchor,
  offerContext,
  suggestedIntent = null,
  mode,
  onSubmit,
  onCancel,
  className = '',
  autoFocus = true,
  onCopy,
  onOpenLink,
}: AnnotationComposerProps) {
  const isRecording = useVoiceStore((s) => s.isRecording)
  const voiceError = useVoiceStore((s) => s.error)
  const [value, setValue] = useState(initialText)
  const [activeIntent, setActiveIntent] = useState<SuggestedIntent | null>(suggestedIntent)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus on mount when asked, and again when the flag flips — the selection
  // composer starts unfocused and is focused later by the first keystroke, so a
  // mount-only `autoFocus` attribute would never fire for it.
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  const quoted = selectionAnchor?.text?.trim() ?? ''
  const offers = useMemo<Offer[]>(() => {
    if (!quoted) return DEFAULT_OFFERS
    return deriveOffers(
      {
        text: quoted,
        scope: selectionAnchor?.scope ?? inferScopeFromText(quoted),
        nodeType: selectionAnchor?.nodeType,
      },
      offerContext,
    )
  }, [quoted, selectionAnchor?.scope, selectionAnchor?.nodeType, offerContext])

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

  const handleQuickAction = async (action: Offer) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      await onSubmit({ text: action.prompt, suggestedIntent: action.intent, skipClassify: true })
      setValue('')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className={`rounded-xl border border-border bg-white shadow-lg ${className}`}>
      {/* Show what the box is holding — otherwise a drag that grabbed a stray
          leading character is invisible until the answer comes back wrong. */}
      {quoted && (
        <p className="px-3 pt-2 text-[11px] font-mono text-muted-foreground truncate" title={quoted}>
          &ldquo;{quoted}&rdquo;
        </p>
      )}
      <div className="flex items-center gap-2 px-3 py-2">
        <input
          ref={inputRef}
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
        />

        <button
          onClick={handleVoiceToggle}
          aria-label={isRecording ? 'Stop recording' : 'Voice input'}
          aria-pressed={isRecording}
          title={isRecording ? 'Stop recording' : 'Voice input'}
          className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors shrink-0 ${
            isRecording
              ? 'bg-red-500 text-white animate-pulse'
              : 'text-muted-foreground hover:text-ink hover:bg-warm'
          }`}
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>
        <button
          onClick={handleSubmit}
          disabled={!value.trim() || isSubmitting}
          aria-label="Submit annotation"
          title="Submit"
          className="w-8 h-8 flex items-center justify-center rounded-full text-white bg-accent hover:bg-accent/80 transition-colors shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>

      <div className="flex flex-wrap gap-1 px-3 pb-2">
        {onCopy && (
          <button
            onClick={onCopy}
            title="Copy the selected text (Cmd/Ctrl+C also works)"
            className="px-2 py-1 text-[10px] font-mono rounded-full border border-border text-muted-foreground transition-colors hover:bg-warm/70 hover:text-ink"
          >
            Copy
          </button>
        )}
        {onOpenLink && (
          <button
            onClick={onOpenLink}
            title="Open in a new tab (Cmd/Ctrl+click the link also works)"
            className="px-2 py-1 text-[10px] font-mono rounded-full border border-accent/40 text-accent transition-colors hover:bg-warm/70"
          >
            Open link
          </button>
        )}
        {offers.map((action) => (
          <button
            key={action.label}
            onClick={() => handleQuickAction(action)}
            disabled={isSubmitting}
            title={`${action.label} — one click, no typing needed`}
            className="px-2 py-1 text-[10px] font-mono rounded-full border transition-colors hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              borderColor: `${ANNOTATION_COLORS[action.intent]}59`,
              color: ANNOTATION_COLORS[action.intent],
            }}
          >
            {action.label}
          </button>
        ))}

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
