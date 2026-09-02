import { useAnnotationStore } from '@/stores/annotationStore'
import { useToastStore } from '@/stores/toastStore'
import { captureAndResolveInBackground } from '@/lib/voice/pipeline'
import type { AnnotationType } from './types'

export interface DrillPayload {
  /** @deprecated kept alongside `quote` for callers not yet migrated — always equal to `quote`. */
  blockText: string
  /** The exact highlighted answer text the sub-chat was spun off from. */
  quote: string
  transcript: string
  suggestedIntent: AnnotationType | null
  /** Preset intent from a one-click action — skip the classify round-trip. */
  skipClassify?: boolean
}

/**
 * Create a sub-annotation from text the reader highlighted inside an AI answer.
 *
 * Deliberate split, unchanged from where this logic used to live inline in
 * ConversationThread: the DOCUMENT position comes from the parent's anchor
 * (there is no document position for text that only exists inside an answer),
 * while the SUBJECT MATTER comes from `quote` — the exact answer text the
 * reader highlighted. Do not "fix" this to derive both from the same source.
 *
 * Extracted so the two render paths in AnnotationCard cannot diverge. The
 * legacy path (a `resolution` with an empty `conversation`) rendered
 * AgentMarkdown with no `interactive`/`onDrill` at all, so highlighting inside
 * those answers silently did nothing — which is why highlight-to-ask read as
 * "I have to click Spin off annotation first".
 */
export function drillFromAnswer(annotationId: string, payload: DrillPayload): void {
  const parent = useAnnotationStore.getState().getById(annotationId)
  const from = parent?.anchor.from ?? 0
  const to = parent?.anchor.to ?? 0

  captureAndResolveInBackground(payload.suggestedIntent ?? 'dig', payload.transcript, from, to, {
    parentId: annotationId,
    suggestedType: payload.suggestedIntent,
    skipClassify: payload.skipClassify,
    quote: payload.quote,
  })
  useToastStore.getState().addToast('Sub-annotation created', 'success')
}
