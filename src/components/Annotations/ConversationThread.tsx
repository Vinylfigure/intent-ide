'use client'

import { useState } from 'react'
import { useEditorStore } from '@/stores/editorStore'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useChangesStore } from '@/stores/changesStore'
import { generateId } from '@/lib/utils/id'
import { createAnnotationFromText } from '@/lib/voice/pipeline'
import type { ConversationMessage, SuggestedEdit } from '@/lib/annotations/types'
import { AgentMarkdown } from '@/components/ui/AgentMarkdown'
import { AnnotationComposer } from './AnnotationComposer'
import { useToastStore } from '@/stores/toastStore'

interface ConversationThreadProps {
  messages: ConversationMessage[]
  annotationId?: string
  /** When true, the last agent message is being streamed */
  isStreaming?: boolean
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function ConversationThread({ messages, annotationId, isStreaming = false }: ConversationThreadProps) {
  const view = useEditorStore((s) => s.view)
  const [spinOffMessageId, setSpinOffMessageId] = useState<string | null>(null)

  const handleApplyEdit = (edit: SuggestedEdit) => {
    if (!view) return

    const tr = view.state.tr.replaceWith(
      edit.from,
      edit.to,
      view.state.schema.text(edit.newText)
    )
    view.dispatch(tr)

    useChangesStore.getState().addEntry({
      id: generateId(),
      documentId: useAnnotationStore.getState().getById(annotationId || '')?.documentId ?? 'unknown',
      rootAnnotationId: annotationId ?? null,
      annotationId: annotationId || '',
      timestamp: Date.now(),
      description: `Applied suggested edit from conversation`,
      beforeSlice: '',
      afterSlice: edit.newText,
      from: edit.from,
      to: edit.to,
      pmStep: null,
      undone: false,
    })
  }

  return (
    <div className="flex flex-col gap-2 mb-3">
      {messages.map((message) => (
        <div key={message.id}>
          {message.role === 'user' ? (
            <div className="bg-warm rounded px-3 py-2">
              <p className="text-sm text-ink">
                <span className="font-bold">You:</span> {message.content}
              </p>
              <span className="text-[10px] font-mono text-muted">
                {formatTimestamp(message.timestamp)}
              </span>
            </div>
          ) : (
            <div className="border-l-2 border-accent pl-3 py-1">
              <div className="text-sm text-ink leading-relaxed">
                <AgentMarkdown
                  content={message.content}
                  isStreaming={isStreaming && message.role === 'agent' && message.id === messages[messages.length - 1]?.id}
                  interactive={!!annotationId && !isStreaming}
                  onDrill={({ transcript, suggestedIntent }) => {
                    if (!annotationId) return
                    // Use the parent's anchor positions for the child
                    const parentAnn = useAnnotationStore.getState().getById(annotationId)
                    const from = parentAnn?.anchor.from ?? 0
                    const to = parentAnn?.anchor.to ?? 0
                    createAnnotationFromText(suggestedIntent ?? 'dig', transcript, from, to, {
                      parentId: annotationId,
                      suggestedType: suggestedIntent,
                    })
                    useToastStore.getState().addToast('Sub-annotation created', 'success')
                  }}
                />
              </div>
              <span className="text-[10px] font-mono text-muted">
                {formatTimestamp(message.timestamp)}
              </span>

              {message.suggestedEdit && (
                <>
                  <div className="mt-2 p-2 bg-annotation-correction/10 border border-annotation-correction/20 rounded text-sm">
                    <span className="text-xs font-mono text-annotation-correction block mb-1">Suggested edit:</span>
                    <p>{message.suggestedEdit.newText}</p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleApplyEdit(message.suggestedEdit!)
                    }}
                    className="mt-1.5 px-2.5 py-1 text-xs font-medium rounded bg-annotation-correction text-white hover:bg-annotation-correction/80 transition-colors"
                  >
                    Apply
                  </button>
                </>
              )}

              {/* Spin off button for agent messages */}
              {annotationId && (
                <div className="mt-1.5">
                  {spinOffMessageId === message.id ? (
                    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                      <AnnotationComposer
                        mode="inline"
                        className="shadow-none"
                        onSubmit={async ({ text, suggestedIntent }) => {
                          if (!view) return
                          const selection = view.state.selection
                          const from = selection.from
                          const to = selection.to !== selection.from ? selection.to : (() => {
                            const $pos = view.state.doc.resolve(selection.from)
                            return $pos.end($pos.depth)
                          })()
                          await createAnnotationFromText(suggestedIntent ?? 'dig', text, from, to, {
                            parentId: annotationId || null,
                            suggestedType: suggestedIntent,
                          })
                          useToastStore.getState().addToast('Sub-annotation created', 'success')
                          setSpinOffMessageId(null)
                        }}
                        onCancel={() => setSpinOffMessageId(null)}
                      />
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setSpinOffMessageId(message.id)
                      }}
                      className="text-[10px] font-medium text-muted hover:text-accent transition-colors"
                    >
                      Spin off annotation
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
