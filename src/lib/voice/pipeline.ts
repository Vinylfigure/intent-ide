import { EditorView } from 'prosemirror-view'
import { AudioRecorder } from './recorder'
import { transcribeAudio } from './transcriber'
import { useVoiceStore } from '@/stores/voiceStore'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useDocumentStore } from '@/stores/documentStore'
import { useChangesStore } from '@/stores/changesStore'
import { useToastStore } from '@/stores/toastStore'
import { classifyAnnotation } from '@/lib/ai/classifier'
import { focusPluginKey } from '@/lib/prosemirror/plugins/focusInferencePlugin'
import {
  addAnnotationDecoration,
  removeAnnotationDecoration,
} from '@/lib/prosemirror/plugins/annotationPlugin'
import { inferScope, getBlockText } from '@/lib/prosemirror/helpers'
import { useFlowStore } from '@/stores/flowStore'
import { answerDwellMs } from '@/lib/annotations/answerReveal'
import { streamResolveAnnotation } from '@/lib/ai/resolver'
import { ingestAnnotationEpisode } from '@/lib/graphrag/episodeIngestion'
import { generateId } from '@/lib/utils/id'
import { getDefaultVerbosity } from '@/lib/annotations/types'
import type { Annotation, AnnotationType, TextAnchor } from '@/lib/annotations/types'

const recorder = new AudioRecorder()

export async function startVoiceCapture(): Promise<void> {
  const voiceStore = useVoiceStore.getState()

  try {
    await recorder.start()
    voiceStore.setRecording(true)
    voiceStore.setError(null)
  } catch (err) {
    voiceStore.setError('Failed to start recording. Check microphone permissions.')
  }
}

export async function stopVoiceCapture(): Promise<void> {
  const voiceStore = useVoiceStore.getState()
  const view = useEditorStore.getState().view

  if (!view) return

  try {
    const transcript = await stopVoiceCaptureForTranscript()

    // 3. Get current focus from ProseMirror
    const focus = focusPluginKey.getState(view.state)
    const selection = view.state.selection

    let from: number
    let to: number

    if (selection.from !== selection.to) {
      // User has text selected
      from = selection.from
      to = selection.to
    } else if (focus?.anchor) {
      // Use inferred focus
      from = focus.anchor.from
      to = focus.anchor.to
    } else {
      // Fallback: current cursor block
      const $pos = view.state.doc.resolve(selection.from)
      from = $pos.start($pos.depth)
      to = $pos.end($pos.depth)
    }

    captureAndResolveInBackground('flag', transcript, from, to)
  } catch (err) {
    voiceStore.setTranscribing(false)
    voiceStore.setError(err instanceof Error ? err.message : 'Voice capture failed')
  }
}

export async function stopVoiceCaptureForTranscript(): Promise<string> {
  const voiceStore = useVoiceStore.getState()
  voiceStore.setRecording(false)
  voiceStore.setTranscribing(true)

  try {
    const audioBlob = await recorder.stop()
    const transcript = await transcribeAudio(audioBlob)
    voiceStore.setTranscript(transcript)
    voiceStore.setTranscribing(false)
    return transcript
  } catch (err) {
    voiceStore.setTranscribing(false)
    voiceStore.setError(err instanceof Error ? err.message : 'Voice capture failed')
    throw err
  }
}

export async function confirmAnnotation(type: AnnotationType): Promise<void> {
  const voiceStore = useVoiceStore.getState()
  const view = useEditorStore.getState().view

  const pending = voiceStore.pendingAnnotation
  if (!pending || !view) return

  // Clear pending
  voiceStore.clearPendingAnnotation()

  // Create annotation, decorate, resolve — resolution runs in the background
  captureAndResolveInBackground(type, pending.transcript, pending.from, pending.to, {
    suggestedType: type,
  })
}

interface CreateAnnotationOptions {
  parentId?: string | null
  suggestedType?: AnnotationType | null
  /** Skip the LLM classify round-trip and use suggestedType (or the provided type) directly. */
  skipClassify?: boolean
  /**
   * How to surface the new annotation: 'panel' (default) scrolls the panel to
   * it; 'quiet' skips the scroll event so capture never yanks attention.
   */
  notify?: 'panel' | 'quiet'
}

/**
 * Per-capture options that the background resolve step needs (classify
 * routing). Keyed by annotation id; consumed once by resolveCapturedAnnotation.
 */
const captureOptionsById = new Map<string, CreateAnnotationOptions>()

/**
 * Fire-and-forget capture: synchronously create the annotation shell
 * (status 'pending'), decorate it, and register it with the stores. All
 * LLM work (classify + resolve) happens later in resolveCapturedAnnotation.
 *
 * Returns the new annotation id, or null when there is no editor view or
 * active document to attach it to.
 */
export function captureAnnotationFromText(
  type: AnnotationType,
  transcript: string,
  from: number,
  to: number,
  options: CreateAnnotationOptions = {},
): string | null {
  const annotationStore = useAnnotationStore.getState()
  const view = useEditorStore.getState().view
  const documentId = useDocumentStore.getState().activeDocumentId

  if (!view || !documentId) return null

  // Infer scope
  const scope = inferScope(view.state, from, to)
  const text = view.state.doc.textBetween(from, to)

  const anchor: TextAnchor = { from, to, scope, text }

  const provisionalType = options.suggestedType ?? type
  const locationGroupKey = `${documentId}:${from}:${to}`

  const annotation: Annotation = {
    id: generateId(),
    documentId,
    locationGroupKey,
    type: provisionalType,
    status: 'pending',
    transcript,
    anchor,
    resolution: null,
    conversation: [],
    parentId: options.parentId ?? null,
    childIds: [],
    createdAt: Date.now(),
    resolvedAt: null,
    verbosity: getDefaultVerbosity(scope, provisionalType),
  }

  annotationStore.add(annotation)
  useChangesStore.getState().ensureChangeSetForAnnotation(annotation)

  // Link to parent if this is a child annotation
  if (options.parentId) {
    const parent = annotationStore.getById(options.parentId)
    if (parent) {
      const existingChildIds = parent.childIds.filter((id) => id !== 'pending')
      annotationStore.update(options.parentId, { childIds: [...existingChildIds, annotation.id] })
    }
  }

  // Add visual decoration
  addAnnotationDecoration(view, annotation.id, from, to, provisionalType)

  // Keep the card active — AnnotationCard's cascade-reveal effect is gated on
  // isActive, so decorated review surfaces depend on this.
  annotationStore.setActive(annotation.id)

  // Signal the panel to scroll to it — unless the caller asked for quiet
  // capture (no mid-reading attention grab).
  if (options.notify !== 'quiet' && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('intent-ide:scroll-to-annotation', { detail: annotation.id }))
  }

  captureOptionsById.set(annotation.id, options)

  return annotation.id
}

/**
 * The background half of annotation creation: classify (unless skipped),
 * refresh the decoration if the type changed, then stream the resolution.
 * Any unexpected failure surfaces as an error agent message + toast — a
 * background capture must never fail silently.
 */
async function resolveCapturedAnnotation(id: string): Promise<void> {
  const options = captureOptionsById.get(id) ?? {}
  captureOptionsById.delete(id)

  try {
    const annotationStore = useAnnotationStore.getState()
    const annotation = annotationStore.getById(id)
    const view = useEditorStore.getState().view
    if (!annotation || !view) {
      throw new Error('Annotation or editor view unavailable')
    }

    const provisionalType = annotation.type
    let classifiedType = provisionalType

    if (options.skipClassify) {
      classifiedType = options.suggestedType ?? provisionalType
    } else {
      try {
        const config = useSettingsStore.getState().llmConfig
        classifiedType = await classifyAnnotation(
          annotation.transcript,
          annotation.anchor.text,
          config,
          options.suggestedType ?? provisionalType,
        )
      } catch {
        // Classification failed — use the provided type as fallback
        classifiedType = options.suggestedType ?? provisionalType
      }
    }

    if (classifiedType !== provisionalType) {
      // Refresh decoration + verbosity for the corrected type
      removeAnnotationDecoration(view, id)
      addAnnotationDecoration(view, id, annotation.anchor.from, annotation.anchor.to, classifiedType)
      annotationStore.update(id, {
        type: classifiedType,
        status: 'classified',
        verbosity: getDefaultVerbosity(annotation.anchor.scope, classifiedType),
      })
    } else {
      annotationStore.update(id, { status: 'classified' })
    }

    // Create a placeholder conversation message for streaming content
    const streamingMessageId = generateId()
    annotationStore.addMessage(id, {
      id: streamingMessageId,
      role: 'agent' as const,
      content: '',
      suggestedEdit: null,
      timestamp: Date.now(),
    })

    // Dispatch streaming sub-agent resolution
    annotationStore.update(id, { status: 'resolving' })
    const current = annotationStore.getById(id)
    if (!current) throw new Error('Annotation removed during resolution')

    const resolution = await streamResolveAnnotation(current, view.state, (partialContent) => {
      // Update the streaming message content as chunks arrive
      annotationStore.updateMessage(id, streamingMessageId, { content: partialContent })
    })

    // Finalize: update message with final content + suggestedEdit, set status
    annotationStore.updateMessage(id, streamingMessageId, {
      content: resolution.content,
      suggestedEdit: resolution.suggestedEdit,
    })

    // Flow-state answer buffering (PRD Event Segmentation): when an ask/dig
    // answer finishes while the user is NOT watching this card stream, hold
    // its PRESENTATION until a reading breakpoint. Status still becomes
    // 'resolved' below — buffering suppresses presentation, never existence.
    const finalType = current.type
    if (
      (finalType === 'ask' || finalType === 'dig') &&
      useFlowStore.getState().bufferAnswersEnabled &&
      useAnnotationStore.getState().activeAnnotationId !== id
    ) {
      const blockText = getBlockText(view.state, current.anchor.from)
      useFlowStore.getState().holdAnswer(id, answerDwellMs(blockText))
    }

    annotationStore.update(id, {
      status: 'resolved',
      resolution,
      resolvedAt: Date.now(),
    })

    // Ingest resolved annotation into GraphRAG (non-blocking)
    const resolvedAnnotation = annotationStore.getById(id)
    if (resolvedAnnotation) {
      ingestAnnotationEpisode(resolvedAnnotation)
    }
  } catch (err) {
    // Background failures must never be silent: finalize the card with an
    // error message and raise a toast.
    const annotationStore = useAnnotationStore.getState()
    annotationStore.addMessage(id, {
      id: generateId(),
      role: 'agent',
      content: `Error: ${err instanceof Error ? err.message : 'Resolution failed'}. Please try again.`,
      suggestedEdit: null,
      timestamp: Date.now(),
    })
    annotationStore.update(id, { status: 'resolved', resolvedAt: Date.now() })
    useToastStore.getState().addToast('Annotation could not be resolved in the background', 'error')
  }
}

/**
 * Original blocking flow, kept for callers that await the full resolution:
 * capture synchronously, then resolve before returning.
 */
export async function createAnnotationFromText(
  type: AnnotationType,
  transcript: string,
  from: number,
  to: number,
  options: CreateAnnotationOptions = {},
): Promise<void> {
  const id = captureAnnotationFromText(type, transcript, from, to, options)
  if (id) await resolveCapturedAnnotation(id)
}

/**
 * Fire-and-forget flow: capture synchronously and let classification +
 * resolution run in the background. Returns the annotation id immediately.
 */
export function captureAndResolveInBackground(
  type: AnnotationType,
  transcript: string,
  from: number,
  to: number,
  options: CreateAnnotationOptions = {},
): string | null {
  const id = captureAnnotationFromText(type, transcript, from, to, options)
  if (id) void resolveCapturedAnnotation(id)
  return id
}

export function cancelAnnotation(): void {
  useVoiceStore.getState().clearPendingAnnotation()
}

export function toggleVoiceCapture() {
  if (recorder.isRecording) {
    stopVoiceCapture()
  } else {
    startVoiceCapture()
  }
}
