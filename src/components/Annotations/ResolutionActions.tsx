'use client'

import { useRef, useState } from 'react'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useEditorStore } from '@/stores/editorStore'
import { useChangesStore } from '@/stores/changesStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useToastStore } from '@/stores/toastStore'
import { removeAnnotationDecoration } from '@/lib/prosemirror/plugins/annotationPlugin'
import { generateId } from '@/lib/utils/id'
import { continueThread, simplifyThread } from '@/lib/ai/resolver'
import { runCascadeCheck } from '@/lib/graphrag/cascadeCheck'
import { ingestAnnotationEpisode, ingestEditEpisode } from '@/lib/graphrag/episodeIngestion'
import { recordHumanDecision, handlerToApprovalAction } from '@/lib/audit/approvalGate'
import { applyUncertaintyFromLogprobs, applyUncertaintyFromFlags } from '@/lib/ai/uncertainty'
import { getProposedAnchors, setProposedEditStatus } from '@/lib/prosemirror/plugins/proposedChangePlugin'
import {
  openCommitReview,
  restoreCommitReview,
  type CommitStatusSnapshot,
} from '@/lib/annotations/commitStatusSnapshot'
import { applyProposedEdits } from '@/lib/prosemirror/applyProposedEdits'
import { recordCascadeDecision } from '@/lib/telemetry/cascadeCalibration'
import {
  createModalDecisionBuffer,
  type BufferedEditMeta,
  type ModalDecisionBuffer,
} from '@/lib/telemetry/modalDecisionBuffer'
import { showAffectedMode } from '@/lib/annotations/showAffected'
import { blockIdAtPos } from '@/lib/prosemirror/blockIds'
import { createCommit } from '@/lib/history/commits'
import { SemanticCommitModal } from '@/components/Editor/SemanticCommitModal'
import type { Annotation, ConversationMessage } from '@/lib/annotations/types'
import { SEVERITY_ORDER } from '@/lib/annotations/types'

interface ResolutionActionsProps {
  annotation: Annotation
}

export function ResolutionActions({ annotation }: ResolutionActionsProps) {
  const updateAnnotation = useAnnotationStore((s) => s.update)
  const view = useEditorStore((s) => s.view)
  const [showDiffModal, setShowDiffModal] = useState(false)
  const [pendingHandler, setPendingHandler] = useState<string | null>(null)
  const [showTweakInput, setShowTweakInput] = useState(false)
  const [tweakText, setTweakText] = useState('')
  // Plugin statuses at modal-open time — cancel restores these so an
  // abandoned review session never leaks its toggles into the inline surfaces.
  const commitSnapshotRef = useRef<CommitStatusSnapshot | null>(null)
  // Modal-source telemetry buffer: toggles inside the modal are provisional
  // (last decision per edit wins), flushed on CONFIRM only, discarded on
  // cancel — so flip noise and abandoned sessions never inflate calibration.
  const modalDecisionsRef = useRef<ModalDecisionBuffer | null>(null)

  if (!annotation.resolution) return null

  const isApplied = annotation.status === 'applied'
  const changeSet = useChangesStore.getState().getChangeSetByAnnotationId(annotation.id)
  const changeSetId = changeSet?.id ?? null
  const rootAnnotationId = changeSet?.rootAnnotationId ?? annotation.parentId ?? annotation.id

  const sendFollowUp = async (ann: Annotation, message: string) => {
    const currentView = useEditorStore.getState().view
    if (!currentView) return

    const annotationStore = useAnnotationStore.getState()

    // Seed conversation with initial resolution if empty (backward compat)
    const freshAnn = annotationStore.getById(ann.id)
    if (freshAnn && (!freshAnn.conversation || freshAnn.conversation.length === 0) && freshAnn.resolution) {
      const seedMsg: ConversationMessage = {
        id: generateId(),
        role: 'agent',
        content: freshAnn.resolution.content,
        suggestedEdit: freshAnn.resolution.suggestedEdit ?? null,
        timestamp: Date.now(),
      }
      annotationStore.addMessage(ann.id, seedMsg)
    }

    // Add user message to conversation
    const userMsg: ConversationMessage = {
      id: generateId(),
      role: 'user',
      content: message,
      suggestedEdit: null,
      timestamp: Date.now(),
    }
    annotationStore.addMessage(ann.id, userMsg)

    // Set status to resolving
    updateAnnotation(ann.id, { status: 'resolving' })

    try {
      // Get fresh annotation with updated conversation
      const freshAnnotation = useAnnotationStore.getState().getById(ann.id)
      if (!freshAnnotation) return

      const agentMsg = await continueThread(freshAnnotation, message, currentView.state)
      useAnnotationStore.getState().addMessage(ann.id, agentMsg)
      updateAnnotation(ann.id, { status: 'resolved' })
    } catch (err) {
      updateAnnotation(ann.id, { status: 'resolved' })
    }
  }

  // Version-history capture for applied AI changes (fire-and-forget — never
  // blocks the apply path). Records the post-apply document as an 'apply'
  // version linked to this annotation and its audit records, then stamps the
  // change set with the resulting version hash.
  const recordApplyCommit = (blockIdsTouched: string[]) => {
    const currentView = useEditorStore.getState().view
    if (!currentView) return
    const auditIds =
      changeSet && changeSet.auditRecordIds.length > 0
        ? changeSet.auditRecordIds
        : annotation.resolution?.auditId
          ? [annotation.resolution.auditId]
          : []
    const transcript = annotation.transcript.trim()
    const message = !transcript
      ? 'AI change applied'
      : transcript.length > 72
        ? `${transcript.slice(0, 69)}...`
        : transcript
    createCommit({
      docJson: currentView.state.doc.toJSON(),
      documentId: annotation.documentId,
      kind: 'apply',
      message,
      annotationId: annotation.id,
      auditIds,
      blockIdsTouched,
      actor: 'ai+human',
      modelVersion: useSettingsStore.getState().llmConfig.model,
    })
      .then(({ hash }) => {
        if (changeSetId) {
          useChangesStore.getState().setChangeSetCommitHash(changeSetId, hash)
        }
      })
      .catch((err) => console.warn('[history] Failed to record version:', err))
  }

  const applyConfirmedEdit = (acceptedIds?: string[]) => {
    // Multi-region path: a cascade run produced several proposed edits. Apply the
    // user-accepted subset (from the commit modal) in one validated transaction
    // (PRD Read-Line + Cascade). Decorations are owned by the AnnotationCard
    // review lifecycle, so we don't set/clear them here. Single-edit resolutions
    // fall through to the original path below (preserving uncertainty highlights).
    const proposed = annotation.resolution?.edits
    if (proposed && proposed.length > 1 && view) {
      const ids = acceptedIds ?? proposed.map((e) => e.id)
      if (ids.length === 0) {
        setShowDiffModal(false)
        setPendingHandler(null)
        return
      }
      const result = applyProposedEdits(view, ids)
      if (!result.ok) {
        useToastStore.getState().addToast(result.reason, 'error')
        setShowDiffModal(false)
        setPendingHandler(null)
        return
      }
      // Calibration telemetry: each APPLIED cascade edit (metadata only;
      // primary edits carry no calibration signal). 'applied' is a distinct
      // action from the accepted/rejected status changes, so no status guard.
      const appliedIds = new Set(ids)
      for (const e of proposed) {
        if (e.relation !== 'cascade' || !appliedIds.has(e.id)) continue
        recordCascadeDecision({
          severity: e.severity,
          edgeType: e.evidence?.edgeType ?? null,
          relation: 'cascade',
          action: 'applied',
          source: 'modal',
        })
      }
      for (const ap of result.applied) {
        useChangesStore.getState().addEntry({
          id: generateId(),
          documentId: annotation.documentId,
          rootAnnotationId,
          annotationId: annotation.id,
          timestamp: Date.now(),
          description: `${annotation.type} (multi-region): ${annotation.transcript.slice(0, 50)}`,
          beforeSlice: ap.targetText,
          afterSlice: ap.newText,
          // Record the resolved old range (pre-apply), matching the single-edit
          // path's convention; before/afterSlice carry the authoritative content.
          from: ap.from,
          to: ap.to,
          pmStep: null,
          undone: false,
        })
      }
      if (changeSetId) {
        useChangesStore.getState().updateChangeSetStatus(changeSetId, 'approved')
      }
      updateAnnotation(annotation.id, { status: 'applied' })
      recordApplyCommit(
        result.applied
          .map((ap) => ap.blockId)
          .filter((blockId): blockId is string => Boolean(blockId)),
      )
      useToastStore.getState().addToast(
        `Applied ${result.applied.length} change${result.applied.length > 1 ? 's' : ''}`,
        'success',
      )
      setShowDiffModal(false)
      setPendingHandler(null)
      return
    }

    // Honor an explicit empty selection from the modal (defensive — single-edit
    // modals can't normally produce one).
    if (acceptedIds && acceptedIds.length === 0) {
      setShowDiffModal(false)
      setPendingHandler(null)
      return
    }

    const edit = annotation.resolution?.suggestedEdit
    if (!edit || !view) return

    // Resolve the touched block before the positions shift under the apply.
    const editedBlockId = blockIdAtPos(view.state.doc, edit.from)

    // Apply the edit to the document
    const tr = view.state.tr.replaceWith(
      edit.from,
      edit.to,
      view.state.schema.text(edit.newText)
    )
    view.dispatch(tr)

    // Record the change
    useChangesStore.getState().addEntry({
      id: generateId(),
      documentId: annotation.documentId,
      rootAnnotationId,
      annotationId: annotation.id,
      timestamp: Date.now(),
      description: `${annotation.type}: ${annotation.transcript.slice(0, 50)}`,
      beforeSlice: annotation.anchor.text,
      afterSlice: edit.newText,
      from: edit.from,
      to: edit.to,
      pmStep: null,
      undone: false,
    })

    if (changeSetId) {
      useChangesStore.getState().updateChangeSetStatus(changeSetId, 'approved')
    }

    updateAnnotation(annotation.id, { status: 'applied' })
    recordApplyCommit(editedBlockId ? [editedBlockId] : [])

    // Apply uncertainty highlights to the newly inserted text
    const newTo = edit.from + edit.newText.length
    if (annotation.resolution?.logprobs?.content) {
      applyUncertaintyFromLogprobs(view, annotation.resolution.logprobs, edit.from, newTo)
    } else if (annotation.resolution?.uncertaintyFlags?.length) {
      applyUncertaintyFromFlags(view, annotation.resolution.uncertaintyFlags, edit.from, newTo)
    }

    // Ingest the edit into GraphRAG (non-blocking)
    ingestEditEpisode(
      annotation.id,
      annotation.anchor.text,
      edit.newText,
      `${annotation.type}: ${annotation.transcript.slice(0, 50)}`,
    )

    // GraphRAG-powered cascade check (falls back to keyword if MCP unavailable)
    runCascadeCheck(view, annotation.anchor.text, edit.newText, edit.from).then(
      (result) => {
        if (result.count > 0) {
          const source = result.usedGraphRAG ? 'knowledge graph' : 'keyword analysis'
          const entities = result.affectedEntities.length > 0
            ? ` (${result.affectedEntities.slice(0, 3).join(', ')})`
            : ''
          useToastStore.getState().addToast(
            `${result.count} related section${result.count > 1 ? 's' : ''} found via ${source}${entities}`,
            'info'
          )
        }
      }
    )

    setShowDiffModal(false)
    setPendingHandler(null)
  }

  // Open the commit modal: snapshot plugin statuses and seed the modal's
  // optional-severity pre-rejections into the plugin (symmetric seeding — all
  // review surfaces agree the moment the modal opens). Cancel restores the
  // snapshot; confirm keeps the live statuses.
  const openCommitModal = () => {
    const edits = annotation.resolution?.edits
    commitSnapshotRef.current =
      view && edits && edits.length > 1 ? openCommitReview(view, edits) : null
    // Telemetry buffer baseline: the OPEN-time statuses (the snapshot taken
    // before the optional pre-rejection seeding), so a toggle that ends where
    // it started flushes nothing on confirm.
    if (edits && edits.length > 1) {
      const editsById = new Map<string, BufferedEditMeta>(
        edits.map((e) => [
          e.id,
          { relation: e.relation, severity: e.severity, evidence: e.evidence },
        ]),
      )
      const openStatuses = new Map(
        edits.map((e) => [e.id, commitSnapshotRef.current?.[e.id] ?? e.status] as const),
      )
      modalDecisionsRef.current = createModalDecisionBuffer(editsById, openStatuses)
    } else {
      modalDecisionsRef.current = null
    }
    setShowDiffModal(true)
  }

  const handleAction = async (handler: string) => {
    // Log human oversight decision if we have an audit trail (non-blocking)
    const auditId = annotation.resolution?.auditId
    const approvalAction = handlerToApprovalAction(handler)
    if (auditId && approvalAction) {
      recordHumanDecision(auditId, approvalAction)
    }

    switch (handler) {
      case 'apply-edit':
      case 'act-on-thought':
      case 'change-from-answer': {
        if (isApplied) break // Prevent double-apply
        const edit = annotation.resolution?.suggestedEdit
        if (edit && view) {
          setPendingHandler(handler)
          openCommitModal()
        }
        break
      }

      case 'add-to-doc': {
        if (isApplied) break
        const edit = annotation.resolution?.suggestedEdit
        if (edit && view) {
          // Has a suggestedEdit — show diff modal
          setPendingHandler(handler)
          openCommitModal()
        } else if (annotation.resolution && view) {
          // No suggestedEdit (ask/dig/flag) — insert resolution content as new paragraph after annotation
          const insertPos = Math.min(annotation.anchor.to, view.state.doc.content.size)
          const newPara = view.state.schema.nodes.paragraph.create(
            null,
            view.state.schema.text(annotation.resolution.content.slice(0, 500))
          )
          const tr = view.state.tr.insert(insertPos, newPara)
          view.dispatch(tr)

          useChangesStore.getState().addEntry({
            id: generateId(),
            documentId: annotation.documentId,
            rootAnnotationId,
            annotationId: annotation.id,
            timestamp: Date.now(),
            description: `Added to doc: ${annotation.transcript.slice(0, 50)}`,
            beforeSlice: '',
            afterSlice: annotation.resolution.content.slice(0, 500),
            from: insertPos,
            to: insertPos,
            pmStep: null,
            undone: false,
          })

          if (changeSetId) {
            useChangesStore.getState().updateChangeSetStatus(changeSetId, 'approved')
          }
          updateAnnotation(annotation.id, { status: 'applied' })
          useToastStore.getState().addToast('Content added to document', 'success')
        }
        break
      }

      case 'dismiss':
      case 'park': {
        updateAnnotation(annotation.id, { status: 'dismissed' })
        if (changeSetId) {
          useChangesStore.getState().updateChangeSetStatus(changeSetId, 'rejected')
        }
        if (view) {
          removeAnnotationDecoration(view, annotation.id)
        }
        break
      }

      case 'explore':
      case 'explore-deeper': {
        await sendFollowUp(annotation, 'Go deeper on this. Provide more detail and evidence.')
        break
      }
      case 'tweak': {
        // Show inline input instead of auto-sending
        if (changeSetId) {
          useChangesStore.getState().updateChangeSetStatus(changeSetId, 'modified')
        }
        setShowTweakInput(true)
        break
      }
      case 'research': {
        await sendFollowUp(annotation, 'Research this thought further. Look for relevant context, implications, and related information in the document.')
        break
      }
      case 'show-cascade': {
        if (view) {
          // Feed the knowledge graph (best-effort) — future doc-graph builds
          // pick these entities up via the graphiti edge pass.
          ingestAnnotationEpisode(annotation)

          // The cascade proposals ARE the affected-sections view (one cascade
          // surface). Scroll/pulse the CascadeList ONLY while it is actually
          // rendered (status 'resolved' + cascade edits) — post-apply the list
          // unmounts, so anything else falls back to a follow-up message that
          // produces visible output instead of a dead button.
          if (showAffectedMode(annotation) === 'scroll') {
            const list = document.querySelector<HTMLElement>(
              `[data-cascade-list="${annotation.id}"]`,
            )
            if (list) {
              list.scrollIntoView({ behavior: 'smooth', block: 'center' })
              list.focus({ preventScroll: true })
              list.classList.remove('cascade-list-flash')
              // Force a reflow so re-triggering restarts the animation.
              void list.offsetWidth
              list.classList.add('cascade-list-flash')
              window.setTimeout(() => list.classList.remove('cascade-list-flash'), 1600)
            }
          } else {
            // No cascade edits to review — fall back to asking the agent for
            // dependent locations as a conversation message.
            await sendFollowUp(annotation, 'Show all other locations in the document that reference or depend on this content. List each location with its text.')
          }
        }
        break
      }
    }
  }

  // Build the commit-modal diffs from the multi-region edits when present,
  // else from the single suggested edit. Rows are ordered primary-first, then
  // by derived severity. Pre-toggle anything rejected inline so the modal and
  // the inline control agree (one source of truth = plugin status).
  const resolutionEdits = annotation.resolution?.edits
  const commitChanges =
    resolutionEdits && resolutionEdits.length > 0
      ? [...resolutionEdits]
          .sort(
            (a, b) =>
              Number(b.relation === 'primary') - Number(a.relation === 'primary') ||
              SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
              a.from - b.from,
          )
          .map((e) => ({
            id: e.id,
            label: `${e.relation === 'primary' ? annotation.type : 'cascade'}: ${e.reason.slice(0, 60)}`,
            before: e.targetText,
            after: e.newText,
            severity: e.severity,
            relation: e.relation,
          }))
      : annotation.resolution?.suggestedEdit
        ? [{
            id: annotation.id,
            label: `${annotation.type}: ${annotation.transcript.slice(0, 60)}`,
            before: annotation.anchor.text,
            after: annotation.resolution.suggestedEdit.newText,
          }]
        : []
  const commitInitialRejected: Record<string, boolean> = {}
  {
    const anchors = view ? getProposedAnchors(view.state) : null
    for (const c of commitChanges) {
      if (anchors?.get(c.id)?.status === 'rejected') commitInitialRejected[c.id] = true
    }
    // Accept-all defaults to must + probably: uncited/stylistic cascades start
    // toggled off unless the user explicitly accepted them inline.
    for (const e of resolutionEdits ?? []) {
      if (e.relation === 'cascade' && e.severity === 'optional') {
        if (anchors?.get(e.id)?.status !== 'accepted') commitInitialRejected[e.id] = true
      }
    }
  }

  return (
    <>
    {showDiffModal && commitChanges.length > 0 && (
      <SemanticCommitModal
        changes={commitChanges}
        initialRejected={commitInitialRejected}
        onToggle={(id, status) => {
          // Modal → plugin write-back: the plugin's status is the single
          // pre-apply source of truth across all review surfaces. No-ops for
          // ids the plugin doesn't track (single-edit fallback rows).
          if (view) {
            // Calibration telemetry: BUFFERED (last decision per edit id),
            // flushed on confirm only — provisional modal flips and cancelled
            // sessions never inflate the counts.
            modalDecisionsRef.current?.toggle(id, status)
            setProposedEditStatus(view, id, status)
          }
        }}
        onConfirm={(ids) => {
          // Confirm: the live statuses stand — drop the snapshot, no restore.
          // Flush the buffered modal decisions (one event per decided edit).
          modalDecisionsRef.current?.confirm()
          modalDecisionsRef.current = null
          commitSnapshotRef.current = null
          applyConfirmedEdit(ids)
        }}
        onCancel={() => {
          // Cancel: restore the open-time statuses so modal toggles (and the
          // open-time optional pre-rejections) don't leak into inline surfaces.
          // Discard the buffered decisions — an abandoned review records nothing.
          modalDecisionsRef.current?.cancel()
          modalDecisionsRef.current = null
          if (view && commitSnapshotRef.current) {
            restoreCommitReview(view, commitSnapshotRef.current)
          }
          commitSnapshotRef.current = null
          setShowDiffModal(false)
          setPendingHandler(null)
        }}
        provocation={annotation.resolution?.provocation}
        isHighRisk={!!annotation.resolution?.usedMADS}
      />
    )}
    <div className="flex flex-wrap gap-2 mt-3">
      {annotation.resolution.actions.map((action) => {
        const isApplyAction = action.kind === 'apply'
        const disabled = isApplyAction && isApplied
        return (
          <button
            key={action.handler}
            onClick={(e) => {
              e.stopPropagation()
              if (!disabled) handleAction(action.handler)
            }}
            disabled={disabled}
            title={action.label}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
              disabled
                ? 'bg-muted/20 text-muted-foreground cursor-not-allowed opacity-50'
                : isApplyAction
                ? 'bg-annotation-correction text-white hover:bg-annotation-correction/80'
                : action.kind === 'dismiss'
                ? 'bg-warm text-muted hover:bg-border'
                : action.kind === 'deepen'
                ? 'bg-annotation-question/10 text-annotation-question hover:bg-annotation-question/20'
                : 'bg-warm text-ink hover:bg-border'
            }`}
          >
            {isApplied && isApplyAction ? 'Applied' : action.label}
          </button>
        )
      })}
      {annotation.conversation && annotation.conversation.length >= 3 && (
        <button
          onClick={async (e) => {
            e.stopPropagation()
            const summary = await simplifyThread(annotation)
            updateAnnotation(annotation.id, {
              conversation: [{
                id: generateId(),
                role: 'agent',
                content: summary,
                suggestedEdit: null,
                timestamp: Date.now(),
              }],
            })
          }}
          className="px-3 py-1.5 text-xs font-medium rounded bg-warm text-muted hover:bg-border transition-colors"
        >
          Simplify thread
        </button>
      )}
    </div>
    {/* Inline tweak input */}
    {showTweakInput && (
      <div className="mt-2 flex gap-2" onClick={(e) => e.stopPropagation()}>
        <input
          type="text"
          value={tweakText}
          onChange={(e) => setTweakText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && tweakText.trim()) {
              sendFollowUp(annotation, `Tweak the suggested edit: ${tweakText}`)
              setShowTweakInput(false)
              setTweakText('')
            } else if (e.key === 'Escape') {
              setShowTweakInput(false)
              setTweakText('')
            }
          }}
          placeholder="How should I tweak this?"
          className="flex-1 px-3 py-1.5 text-xs border border-border rounded focus:outline-none focus:ring-1 focus:ring-accent/30"
          autoFocus
        />
        <button
          onClick={() => {
            if (tweakText.trim()) {
              sendFollowUp(annotation, `Tweak the suggested edit: ${tweakText}`)
              setShowTweakInput(false)
              setTweakText('')
            }
          }}
          className="px-3 py-1.5 text-xs font-medium bg-ink text-white rounded hover:bg-ink/80 transition-colors"
        >
          Send
        </button>
      </div>
    )}
    </>
  )
}
