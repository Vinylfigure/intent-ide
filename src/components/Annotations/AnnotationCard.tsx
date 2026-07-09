'use client'

import { useState, useCallback, useEffect } from 'react'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useEditorStore } from '@/stores/editorStore'
import { TextSelection } from 'prosemirror-state'
import {
  setProposedEdits,
  clearProposedEdits,
  revealProposedEdits,
  getProposedAnchors,
} from '@/lib/prosemirror/plugins/proposedChangePlugin'
import { readLinePluginKey } from '@/lib/prosemirror/plugins/readLinePlugin'
import { partitionCascadeReveal, cascadeBreakpointPos, pollCascadeReveal } from '@/lib/annotations/cascadeReveal'
import { ResolutionActions } from './ResolutionActions'
import { CascadeList } from './CascadeList'
import { ConversationThread } from './ConversationThread'
import { FollowUpInput } from './FollowUpInput'
import { continueThread, streamResolveAnnotation } from '@/lib/ai/resolver'
import { generateId } from '@/lib/utils/id'
import type { Annotation, AnnotationType, ConversationMessage } from '@/lib/annotations/types'
import { ANNOTATION_COLORS, ANNOTATION_LABELS, ANNOTATION_DESCRIPTIONS, getDefaultVerbosity } from '@/lib/annotations/types'
import { AgentMarkdown } from '@/components/ui/AgentMarkdown'
import { ResolutionProgress } from './ResolutionProgress'

const ALL_TYPES: AnnotationType[] = ['ask', 'edit', 'dig', 'flag']

/** Whether an override requires re-running resolution */
function isMutatingOverride(from: AnnotationType, to: AnnotationType): boolean {
  // Anything involving 'edit' is mutating (different routing, produces suggestedEdit)
  return from === 'edit' || to === 'edit'
}

interface AnnotationCardProps {
  annotation: Annotation
  isActive: boolean
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  classified: 'Classified',
  resolving: 'Thinking...',
  resolved: 'Ready',
  applied: 'Applied',
  dismissed: 'Dismissed',
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  classified: 'bg-sky-100 text-sky-800',
  resolving: 'bg-blue-100 text-blue-800',
  resolved: 'bg-emerald-100 text-emerald-800',
  applied: 'bg-green-100 text-green-800',
  dismissed: 'bg-stone-200 text-stone-700',
}

export function AnnotationCard({ annotation, isActive }: AnnotationCardProps) {
  const setActive = useAnnotationStore((s) => s.setActive)
  const updateAnnotation = useAnnotationStore((s) => s.update)
  const addMessage = useAnnotationStore((s) => s.addMessage)
  const view = useEditorStore((s) => s.view)
  const [showBadgeDropdown, setShowBadgeDropdown] = useState(false)

  // Decoration review lifecycle (PRD Read-Line + Cascade): while this card is the
  // active one and its resolution carries multi-region edits still under review,
  // "call out" those regions in the editor; clear them once it deactivates or the
  // edits are applied/dismissed (status leaves 'resolved'). Only the active card
  // touches decorations, so inactive cards never dispatch.
  // Flow-state buffering (PRD, reveal-flag design): the plugin ALWAYS receives
  // the FULL edit set so every edit has a live apply-time anchor from the first
  // dispatch; cascades BELOW the read-line are stored revealed:false (no
  // decoration yet) and flipped visible — statuses untouched — once the
  // read-line high-water mark crosses the end of the primary edit's block (a
  // coarse breakpoint). The read-line only advances via editor transactions,
  // so a light poll of the plugin state is the simplest robust observer (no
  // plugin-view registration, no extra store). Each poll tick reads LIVE
  // mapped anchors (pollCascadeReveal) so typing during the hold shifts the
  // partition and the breakpoint correctly. A highWaterMark of 0 — no reading
  // tracked yet — reveals everything immediately (see partitionCascadeReveal).
  const reviewEdits = annotation.resolution?.edits
  useEffect(() => {
    if (!view || !isActive) return
    if (annotation.status === 'resolved' && reviewEdits && reviewEdits.length > 1) {
      const primary = reviewEdits.find((e) => e.relation === 'primary')
      const breakpoint = cascadeBreakpointPos(view.state.doc, primary)
      const highWaterMark = readLinePluginKey.getState(view.state)?.highWaterMark ?? 0
      const { held } = partitionCascadeReveal(reviewEdits, highWaterMark, breakpoint)
      setProposedEdits(view, reviewEdits, held.map((e) => e.id))
      if (held.length > 0) {
        const timer = setInterval(() => {
          const ids = pollCascadeReveal(view.state)
          if (ids.length > 0) revealProposedEdits(view, ids)
          let anyHeld = false
          for (const a of getProposedAnchors(view.state).values()) {
            if (!a.revealed) { anyHeld = true; break }
          }
          if (!anyHeld) clearInterval(timer)
        }, 500)
        return () => {
          clearInterval(timer)
          clearProposedEdits(view)
        }
      }
    } else {
      clearProposedEdits(view)
    }
    return () => {
      clearProposedEdits(view)
    }
  }, [isActive, annotation.status, reviewEdits, view])

  const handleBadgeOverride = async (newType: AnnotationType) => {
    setShowBadgeDropdown(false)
    if (newType === annotation.type) return

    if (isMutatingOverride(annotation.type, newType)) {
      // Re-run resolution with new type
      updateAnnotation(annotation.id, { type: newType, status: 'resolving', resolution: null, conversation: [] })
      if (view) {
        const updatedAnnotation = { ...annotation, type: newType }

        const streamingMessageId = generateId()
        useAnnotationStore.getState().addMessage(annotation.id, {
          id: streamingMessageId,
          role: 'agent',
          content: '',
          suggestedEdit: null,
          timestamp: Date.now(),
        })

        const resolution = await streamResolveAnnotation(updatedAnnotation, view.state, (partialContent) => {
          useAnnotationStore.getState().updateMessage(annotation.id, streamingMessageId, { content: partialContent })
        })

        useAnnotationStore.getState().updateMessage(annotation.id, streamingMessageId, {
          content: resolution.content,
          suggestedEdit: resolution.suggestedEdit,
        })
        updateAnnotation(annotation.id, { status: 'resolved', resolution, resolvedAt: Date.now() })
      }
    } else {
      // Non-mutating: just relabel
      updateAnnotation(annotation.id, { type: newType })
      if (annotation.resolution) {
        updateAnnotation(annotation.id, { resolution: { ...annotation.resolution, type: newType } })
      }
    }
  }

  const handleFollowUp = async (text: string) => {
    if (!view) return

    try {
      updateAnnotation(annotation.id, { status: 'resolving' })

      const userMessage: ConversationMessage = {
        id: generateId(),
        role: 'user',
        content: text,
        suggestedEdit: null,
        timestamp: Date.now(),
      }
      addMessage(annotation.id, userMessage)

      const agentMessage = await continueThread(annotation, text, view.state)
      addMessage(annotation.id, agentMessage)

      updateAnnotation(annotation.id, { status: 'resolved' })
    } catch (err) {
      console.error('Follow-up failed:', err)
      const errorMessage: ConversationMessage = {
        id: generateId(),
        role: 'agent',
        content: `Error: ${err instanceof Error ? err.message : 'Follow-up failed'}. Please try again.`,
        suggestedEdit: null,
        timestamp: Date.now(),
      }
      addMessage(annotation.id, errorMessage)
      updateAnnotation(annotation.id, { status: 'resolved' })
    }
  }

  const scrollToAnchor = useCallback(() => {
    if (!view || !annotation.anchor.from) return

    const { from, to } = annotation.anchor
    const maxPos = view.state.doc.content.size

    // Clamp positions to valid range
    const safeFrom = Math.min(from, maxPos)
    const safeTo = Math.min(to, maxPos)

    // Try smooth scroll via coordinates
    try {
      const coords = view.coordsAtPos(safeFrom)
      if (coords) {
        const container = view.dom.closest('.editor-scroll-container')
        if (container) {
          const containerRect = container.getBoundingClientRect()
          container.scrollTo({
            top: container.scrollTop + (coords.top - containerRect.top) - 100,
            behavior: 'smooth',
          })
        }
      }
    } catch {
      // Fallback: set selection and focus to force scroll
    }

    // Set cursor at annotation range and focus
    try {
      const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, safeFrom, safeTo))
      view.dispatch(tr)
      view.focus()
    } catch {
      // Position may be out of range after doc change
    }
  }, [view, annotation.anchor])

  const handleClick = () => {
    setActive(isActive ? null : annotation.id)
    if (!isActive) {
      scrollToAnchor()
    }
  }

  const color = ANNOTATION_COLORS[annotation.type]
  const label = ANNOTATION_LABELS[annotation.type]
  const defaultVerbosity = getDefaultVerbosity(annotation.anchor.scope, annotation.type)
  const currentVerbosity = annotation.verbosity || defaultVerbosity
  const showRegenerate = currentVerbosity !== defaultVerbosity

  return (
    <div
      data-annotation-id={annotation.id}
      onClick={handleClick}
      className={`px-4 py-3 cursor-pointer transition-all ${
        isActive
          ? 'bg-white shadow-[inset_3px_0_0_0_rgba(196,75,43,0.9)]'
          : 'hover:bg-white/70'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowBadgeDropdown(!showBadgeDropdown)
            }}
            title={`${label} — ${ANNOTATION_DESCRIPTIONS[annotation.type]}. Click to change.`}
            className="text-xs font-mono font-medium px-2.5 py-1 rounded-full cursor-pointer hover:opacity-80 transition-opacity shadow-sm"
            style={{ backgroundColor: color + '18', color }}
          >
            {label}
          </button>
          {showBadgeDropdown && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-border rounded-lg shadow-lg z-10 py-1 min-w-[140px]">
              {ALL_TYPES.map((type) => (
                <button
                  key={type}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleBadgeOverride(type)
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs font-medium hover:bg-warm transition-colors flex items-center gap-2 ${
                    type === annotation.type ? 'font-bold' : ''
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: ANNOTATION_COLORS[type] }}
                  />
                  <span style={{ color: ANNOTATION_COLORS[type] }}>{ANNOTATION_LABELS[type]}</span>
                  <span className="text-muted-foreground ml-auto">{ANNOTATION_DESCRIPTIONS[type]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${STATUS_STYLES[annotation.status] ?? 'bg-stone-100 text-stone-700'}`}>
          {STATUS_LABELS[annotation.status] || annotation.status}
        </span>
      </div>

      {/* Transcript */}
      <p className="text-sm text-ink leading-relaxed mb-1 font-medium">
        {annotation.transcript}
      </p>

      {/* Anchor — clickable quoted excerpt that scrolls to position */}
      <button
        onClick={(e) => { e.stopPropagation(); scrollToAnchor() }}
        className="w-full text-left text-xs text-ink/60 bg-warm/40 hover:bg-warm/70 rounded-lg px-2.5 py-1.5 border-l-2 border-accent/30 transition-colors cursor-pointer truncate"
        title="Click to scroll to this passage"
      >
        &ldquo;{annotation.anchor.text.slice(0, 50)}{annotation.anchor.text.length > 50 ? '...' : ''}&rdquo;
      </button>

      {/* Parent/child badges */}
      {annotation.parentId && (
        <button
          onClick={(e) => { e.stopPropagation(); setActive(annotation.parentId!) }}
          className="mt-1 text-[10px] font-mono text-accent hover:underline"
        >
          parent thread
        </button>
      )}
      {annotation.childIds && annotation.childIds.length > 0 && (
        <div className="mt-1 flex gap-1 flex-wrap">
          {annotation.childIds.map((childId) => (
            <button
              key={childId}
              onClick={(e) => { e.stopPropagation(); setActive(childId) }}
              className="text-[10px] font-mono text-accent hover:underline"
            >
              child
            </button>
          ))}
        </div>
      )}

      {/* Verbosity toggle (when active and resolved) */}
      {isActive && annotation.resolution && (
        <div className="mt-2 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <span className="text-[10px] font-mono text-muted-foreground mr-1">Length:</span>
          {(['concise', 'normal', 'detailed'] as const).map((v) => (
            <button
              key={v}
              onClick={() => {
                updateAnnotation(annotation.id, { verbosity: v })
              }}
              className={`px-2 py-0.5 text-[10px] font-mono rounded transition-colors ${
                currentVerbosity === v
                  ? 'bg-ink text-white shadow-sm'
                  : 'text-muted-foreground hover:bg-warm/80'
              }`}
            >
              {v === 'concise' ? 'Short' : v === 'normal' ? 'Normal' : 'Long'}
            </button>
          ))}
          {showRegenerate && (
            <button
              onClick={async () => {
                if (!view) return
                // Read fresh from store to avoid stale closure
                const current = useAnnotationStore.getState().getById(annotation.id)
                if (!current || current.status === 'resolving') return
                updateAnnotation(annotation.id, { status: 'resolving', conversation: [] })
                const msgId = generateId()
                useAnnotationStore.getState().addMessage(annotation.id, {
                  id: msgId, role: 'agent', content: '', suggestedEdit: null, timestamp: Date.now(),
                })
                const resolution = await streamResolveAnnotation(current, view.state, (partial) => {
                  useAnnotationStore.getState().updateMessage(annotation.id, msgId, { content: partial })
                })
                useAnnotationStore.getState().updateMessage(annotation.id, msgId, {
                  content: resolution.content, suggestedEdit: resolution.suggestedEdit,
                })
                updateAnnotation(annotation.id, { status: 'resolved', resolution, resolvedAt: Date.now() })
              }}
              disabled={annotation.status === 'resolving'}
              className="px-2 py-0.5 text-[10px] font-mono text-accent hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Regenerate
            </button>
          )}
        </div>
      )}

      {/* Inline provocation callout (when MADS raised an unresolved objection) */}
      {isActive && annotation.resolution?.provocation && (
        <div className="mt-3 mx-1 p-3 border border-amber-300 bg-amber-50 rounded-xl shadow-sm">
          <div className="flex items-start gap-2">
            <span className="text-amber-600 text-xs font-bold shrink-0">⚠</span>
            <div className="flex-1">
              <p className="text-[10px] font-mono font-medium text-amber-800 mb-0.5">AI Challenge</p>
              <p className="text-xs text-amber-900 italic leading-relaxed">{annotation.resolution.provocation}</p>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleFollowUp(`Tell me more about this concern: ${annotation.resolution!.provocation}`)
                }}
                className="mt-1.5 text-[10px] font-medium text-amber-700 hover:text-amber-900 hover:underline"
              >
                Tell me more
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cascade review list — navigable "affects N sections" (when active) */}
      {isActive && <CascadeList annotation={annotation} />}

      {/* Conversation thread (when active and has conversation messages) */}
      {isActive && annotation.conversation && annotation.conversation.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border/70" onClick={(e) => e.stopPropagation()}>
          <ConversationThread messages={annotation.conversation} annotationId={annotation.id} isStreaming={annotation.status === 'resolving'} />
          {annotation.resolution && <ResolutionActions annotation={annotation} />}
          <FollowUpInput
            annotation={annotation}
            onSend={handleFollowUp}
            disabled={annotation.status === 'resolving'}
          />
        </div>
      )}

      {/* Resolution content (when active, resolved, and no conversation — backward compatibility) */}
      {isActive && annotation.resolution && (!annotation.conversation || annotation.conversation.length === 0) && (
        <div className="mt-3 pt-3 border-t border-border/70" onClick={(e) => e.stopPropagation()}>
          <div className="text-sm text-ink leading-relaxed">
            <AgentMarkdown content={annotation.resolution.content} />
          </div>

          {annotation.resolution.suggestedEdit && (
            <div className="mt-2 p-3 bg-annotation-correction/10 border border-annotation-correction/20 rounded-xl text-sm">
              <span className="text-xs font-mono text-annotation-correction block mb-1">Suggested edit:</span>
              <p>{annotation.resolution.suggestedEdit.newText}</p>
            </div>
          )}

          <ResolutionActions annotation={annotation} />
          <FollowUpInput
            annotation={annotation}
            onSend={handleFollowUp}
            disabled={annotation.status === 'resolving'}
          />
        </div>
      )}

      {/* Loading state with staged progress */}
      {annotation.status === 'resolving' && (
        <ResolutionProgress
          stage={
            !annotation.resolution ? 'classifying'
              : annotation.conversation && annotation.conversation.some(m => m.role === 'agent' && m.content.length > 0) ? 'streaming'
              : 'analyzing'
          }
        />
      )}
    </div>
  )
}
