import { EditorView } from 'prosemirror-view'
import { AudioRecorder } from './recorder'
import { transcribeAudio } from './transcriber'
import { useVoiceStore } from '@/stores/voiceStore'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useDocumentStore } from '@/stores/documentStore'
import { useChangesStore } from '@/stores/changesStore'
import { classifyAnnotation } from '@/lib/ai/classifier'
import { focusPluginKey } from '@/lib/prosemirror/plugins/focusInferencePlugin'
import { addAnnotationDecoration } from '@/lib/prosemirror/plugins/annotationPlugin'
import { inferScope } from '@/lib/prosemirror/helpers'
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

    await createAnnotationFromText('flag', transcript, from, to)
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
  const annotationStore = useAnnotationStore.getState()
  const view = useEditorStore.getState().view

  const pending = voiceStore.pendingAnnotation
  if (!pending || !view) return

  const anchor: TextAnchor = {
    from: pending.from,
    to: pending.to,
    scope: pending.scope,
    text: pending.text,
  }

  // Clear pending
  voiceStore.clearPendingAnnotation()

  // Create annotation, decorate, resolve via reusable function
  await createAnnotationFromText(type, pending.transcript, pending.from, pending.to, {
    suggestedType: type,
  })
}

interface CreateAnnotationOptions {
  parentId?: string | null
  suggestedType?: AnnotationType | null
}

export async function createAnnotationFromText(
  type: AnnotationType,
  transcript: string,
  from: number,
  to: number,
  options: CreateAnnotationOptions = {},
): Promise<void> {
  const annotationStore = useAnnotationStore.getState()
  const view = useEditorStore.getState().view
  const documentId = useDocumentStore.getState().activeDocumentId

  if (!view || !documentId) return

  // Infer scope
  const scope = inferScope(view.state, from, to)
  const text = view.state.doc.textBetween(from, to)

  const anchor: TextAnchor = { from, to, scope, text }

  // Classify intent from user input + selected text (invisible classification)
  let classifiedType = type
  try {
    const config = useSettingsStore.getState().llmConfig
    classifiedType = await classifyAnnotation(transcript, text, config, options.suggestedType ?? type)
  } catch {
    // Classification failed — use the provided type as fallback
    classifiedType = options.suggestedType ?? type
  }

  const locationGroupKey = `${documentId}:${from}:${to}`

  // Create annotation with classified type
  const annotation: Annotation = {
    id: generateId(),
    documentId,
    locationGroupKey,
    type: classifiedType,
    status: 'classified',
    transcript,
    anchor,
    resolution: null,
    conversation: [],
    parentId: options.parentId ?? null,
    childIds: [],
    createdAt: Date.now(),
    resolvedAt: null,
    verbosity: getDefaultVerbosity(scope, classifiedType),
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
  addAnnotationDecoration(view, annotation.id, from, to, classifiedType)

  // Set active and signal panel to scroll to it
  annotationStore.setActive(annotation.id)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('intent-ide:scroll-to-annotation', { detail: annotation.id }))
  }

  // Create a placeholder conversation message for streaming content
  const streamingMessageId = generateId()
  const streamingMessage = {
    id: streamingMessageId,
    role: 'agent' as const,
    content: '',
    suggestedEdit: null,
    timestamp: Date.now(),
  }
  annotationStore.addMessage(annotation.id, streamingMessage)

  // Dispatch streaming sub-agent resolution
  annotationStore.update(annotation.id, { status: 'resolving' })
  const resolution = await streamResolveAnnotation(annotation, view.state, (partialContent) => {
    // Update the streaming message content as chunks arrive
    annotationStore.updateMessage(annotation.id, streamingMessageId, { content: partialContent })
  })

  // Finalize: update message with final content + suggestedEdit, set status
  annotationStore.updateMessage(annotation.id, streamingMessageId, {
    content: resolution.content,
    suggestedEdit: resolution.suggestedEdit,
  })
  annotationStore.update(annotation.id, {
    status: 'resolved',
    resolution,
    resolvedAt: Date.now(),
  })

  // Ingest resolved annotation into GraphRAG (non-blocking)
  const resolvedAnnotation = annotationStore.getById(annotation.id)
  if (resolvedAnnotation) {
    ingestAnnotationEpisode(resolvedAnnotation)
  }
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
