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
import { AI_APPLY_META, applyProposedEdits, applySingleEdit } from '@/lib/prosemirror/applyProposedEdits'
import { recordCascadeDecision } from '@/lib/telemetry/cascadeCalibration'
import {
  createModalDecisionBuffer,
  type BufferedEditMeta,
  type ModalDecisionBuffer,
} from '@/lib/telemetry/modalDecisionBuffer'
import { showAffectedMode } from '@/lib/annotations/showAffected'
import { previewBlastRadiusDetail } from '@/lib/annotations/blastRadius'
import { judgeRelatedPassages, type JudgeSeed, type PassageVerdict } from '@/lib/ai/judgeRelatedPassages'
import { findBlockById } from '@/lib/prosemirror/blockIds'
import { pulseBlock, scrollToPos } from '@/lib/prosemirror/scrollToPos'
import { blockIdAtPos } from '@/lib/prosemirror/blockIds'
import { refreshAnchorAfterApply, refreshedAnchorForMultiRegionApply } from '@/lib/annotations/anchoring'
import { createCommit } from '@/lib/history/commits'
import { resolveApplyAuditIds } from '@/lib/annotations/applyAuditLinkage'
import { recordInvariant, shouldCaptureInvariant } from '@/lib/invariants/captureInvariant'
import { resolveInvariantFlagOnDismiss, runAndSurfaceInvariantChecks } from '@/lib/invariants/invariantCascade'
import { classifyCheckKind } from '@/lib/invariants/invariantCheckRunner'
import { SemanticCommitModal, type InvariantCapture } from '@/components/Editor/SemanticCommitModal'
import type { Annotation, ConversationMessage } from '@/lib/annotations/types'
import { SEVERITY_ORDER } from '@/lib/annotations/types'

interface ResolutionActionsProps {
  annotation: Annotation
}

// Handlers whose case body only opens SemanticCommitModal (setPendingHandler
// + openCommitModal) — no decision has actually happened yet at the point
// handleAction runs. 'add-to-doc' is conditionally modal-gated: only when
// there's a suggestedEdit to review (see its case body below); with no
// suggestedEdit it decides immediately in the same synchronous call.
const ALWAYS_MODAL_GATED_HANDLERS = new Set(['apply-edit', 'act-on-thought', 'change-from-answer'])

function opensCommitModal(handler: string, hasSuggestedEdit: boolean): boolean {
  if (ALWAYS_MODAL_GATED_HANDLERS.has(handler)) return true
  return handler === 'add-to-doc' && hasSuggestedEdit
}

export function ResolutionActions({ annotation }: ResolutionActionsProps) {
  const updateAnnotation = useAnnotationStore((s) => s.update)
  const view = useEditorStore((s) => s.view)
  const [showDiffModal, setShowDiffModal] = useState(false)
  const [pendingHandler, setPendingHandler] = useState<string | null>(null)
  const [showTweakInput, setShowTweakInput] = useState(false)
  const [tweakText, setTweakText] = useState('')
  const [isSimplifying, setIsSimplifying] = useState(false)
  // Opt-in LLM second opinion on the blast-radius preview (never on the
  // mouse-up/selection path — only when the reader clicks "Check these").
  // Keyed by blockId, not array index, so a verdict never gets misattributed
  // if the underlying passage list changes shape between renders.
  const [isJudgingPassages, setIsJudgingPassages] = useState(false)
  const [passageVerdicts, setPassageVerdicts] = useState<Map<string, PassageVerdict> | null>(null)
  const judgeEnabled = useSettingsStore((s) => s.judgeEnabled)
  // Plugin statuses at modal-open time — cancel restores these so an
  // abandoned review session never leaks its toggles into the inline surfaces.
  const commitSnapshotRef = useRef<CommitStatusSnapshot | null>(null)
  // Modal-source telemetry buffer: toggles inside the modal are provisional
  // (last decision per edit wins), flushed on CONFIRM only, discarded on
  // cancel — so flip noise and abandoned sessions never inflate calibration.
  const modalDecisionsRef = useRef<ModalDecisionBuffer | null>(null)
  // Document Invariant Ledger: the fact the user chose to declare at
  // confirm time (or null), captured once the resulting apply commit's hash
  // is known so the ledger row carries real provenance.
  const pendingInvariantRef = useRef<InvariantCapture | null>(null)

  if (!annotation.resolution) return null

  const isApplied = annotation.status === 'applied'
  const changeSet = useChangesStore.getState().getChangeSetByAnnotationId(annotation.id)
  const changeSetId = changeSet?.id ?? null
  const rootAnnotationId = changeSet?.rootAnnotationId ?? annotation.parentId ?? annotation.id

  const sendFollowUp = async (ann: Annotation, message: string) => {
    const currentView = useEditorStore.getState().view
    if (!currentView) return

    const annotationStore = useAnnotationStore.getState()

    // A terminal status (applied/dismissed) has no legal outgoing transition
    // at all (lifecycle.ts's TRANSITIONS) — deepen-kind actions (Go deeper,
    // Tweak it, Show affected, Research more) stay clickable after Apply, and
    // without this check a follow-up fired from one of them would
    // unconditionally overwrite that terminal status, no race required
    // (round 3 of #100's adversarial review). Bail before touching the
    // conversation at all.
    // Deliberately narrower than `!canTransition(status, 'resolving')`:
    // TRANSITIONS['resolving'] only lists 'resolved', not 'resolving' itself
    // (it isn't modeled as a self-transition), so that check would also
    // reject a SECOND legitimate concurrent follow-up landing while the
    // first is still in flight — a case rounds 1-2 deliberately preserved,
    // not one this guard is meant to block.
    const currentStatus = annotationStore.getById(ann.id)?.status
    if (currentStatus === 'applied' || currentStatus === 'dismissed') {
      useToastStore.getState().addToast(
        'This annotation has already been applied or dismissed — start a new annotation to continue.',
        'info'
      )
      return
    }

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

    // A terminal action (apply/dismiss) can complete on this annotation while
    // this follow-up is still in flight — its status is authoritative once
    // reached (see lifecycle.ts's TRANSITIONS: 'applied'/'dismissed' have no
    // legal outgoing edges), and a late-settling follow-up must never
    // resurrect it back to 'resolved' out from under that decision. Only
    // write 'resolved' while this follow-up's own 'resolving' status still
    // stands.
    const finishFollowUp = () => {
      if (useAnnotationStore.getState().getById(ann.id)?.status === 'resolving') {
        updateAnnotation(ann.id, { status: 'resolved' })
      }
    }

    try {
      // Get fresh annotation with updated conversation
      const freshAnnotation = useAnnotationStore.getState().getById(ann.id)
      if (!freshAnnotation) return
      // Snapshot the message ids the request is generated from. A benign
      // concurrent write (a second legitimate follow-up appending its own
      // message, or the fire-and-forget audit-outcome sync in resolver.ts's
      // `syncMessageAuditOutcome` patching an existing message's metadata)
      // always allocates a NEW conversation array too, so plain reference
      // equality can't tell those apart from a real collapse (e.g. "Simplify
      // thread", #100) — it would false-positive-discard a perfectly good
      // reply. A genuine collapse instead REPLACES the whole conversation
      // with unrelated ids, so checking for id overlap survives the benign
      // cases while still catching a real one.
      const snapshotIds = new Set(freshAnnotation.conversation.map((m) => m.id))

      const agentMsg = await continueThread(freshAnnotation, message, currentView.state)

      const live = useAnnotationStore.getState().getById(ann.id)
      if (!live) return // Annotation was deleted while the request was in flight.
      const collapsed = snapshotIds.size > 0 && !live.conversation.some((m) => snapshotIds.has(m.id))
      if (collapsed) {
        // The reply was generated from context that no longer exists (e.g. a
        // collapse via "Simplify thread") — appending it now would silently
        // attach a stale-context reply to the fresh conversation with no
        // indication to the user. Discard it instead.
        useToastStore.getState().addToast(
          'This conversation changed while replying — the new reply was generated from context that no longer exists, so it was discarded.',
          'error'
        )
        finishFollowUp()
        return
      }
      useAnnotationStore.getState().addMessage(ann.id, agentMsg)
      finishFollowUp()
    } catch (err) {
      console.error('Follow-up failed:', err)
      useToastStore.getState().addToast('Sending that follow-up failed — try again.', 'error')
      finishFollowUp()
    }
  }

  // Version-history capture for applied AI changes (fire-and-forget — never
  // blocks the apply path). Records the post-apply document as an 'apply'
  // version linked to this annotation and its audit records, then stamps the
  // change set with the resulting version hash.
  const recordApplyCommit = (blockIdsTouched: string[]) => {
    const currentView = useEditorStore.getState().view
    if (!currentView) return
    // If the audit write hasn't settled yet (still in flight, neither
    // auditId nor auditFailed set), this version is committed with zero
    // audit ids and is never backfilled if the write later succeeds — a
    // narrower, documented sibling of the auditFailed gap (see
    // docs/compliance.md and #83).
    const auditIds = resolveApplyAuditIds(changeSet?.auditRecordIds, annotation.resolution?.auditId)
    // Warn rather than silently apply with a zero-audit-links version — see
    // #77. Only fires when the write is KNOWN to have failed (auditFailed),
    // not merely still in flight (which would false-positive on a fast click).
    if (auditIds.length === 0 && annotation.resolution?.auditFailed) {
      useToastStore.getState().addToast(
        'Audit record for this resolution failed to save — applying anyway, but this version has no linked compliance record.',
        'error'
      )
    }
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
        // The user may have declared a fact in the commit modal — capture it
        // now that we have the real provenance commit hash for this version.
        const invariant = pendingInvariantRef.current
        pendingInvariantRef.current = null
        if (invariant) {
          recordInvariant({
            documentId: annotation.documentId,
            statement: invariant.statement,
            blockIds: invariant.blockIds,
            // Decide the lane at capture time (#51) instead of letting every
            // row default to 'deterministic'. This routes the statements the
            // figure-matching lane provably cannot check ("thirty days") to
            // the entailment lane up front; statements it can only sometimes
            // check still start here and fall through at check time — see
            // `classifyCheckKind` for the split.
            checkKind: classifyCheckKind(invariant.statement),
            provenanceCommitHash: hash,
          })
        }
        // Doc-CI (issue #32): this version just landed — re-check every
        // previously declared fact against it. Fire-and-forget (the function
        // never rejects — internal failures are caught and logged there).
        void runAndSurfaceInvariantChecks(annotation.documentId, currentView.state)
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
        pendingInvariantRef.current = null
        setShowDiffModal(false)
        setPendingHandler(null)
        return
      }
      const result = applyProposedEdits(view, ids)
      if (!result.ok) {
        pendingInvariantRef.current = null
        useToastStore.getState().addToast(result.reason, 'error')
        setShowDiffModal(false)
        setPendingHandler(null)
        return
      }
      // Calibration telemetry: each APPLIED cascade edit (metadata only;
      // primary edits carry no calibration signal). 'applied' is a distinct
      // action from the accepted/rejected status changes, so no status guard.
      // Keyed on result.applied (not the accepted ids) so no-op edits that
      // were skipped by applyProposedEdits never record an 'applied' event.
      const appliedIds = new Set(result.applied.map((ap) => ap.id))
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
      // Refresh the primary edit's anchor to its TRUE post-transaction
      // position — mirrors the single-edit path below (see
      // refreshedAnchorForMultiRegionApply's doc comment for why
      // result.applied's own position can't be trusted for anything but the
      // lowest-`from` edit in the batch — #44). Returns undefined for a
      // missing/rejected/no-op/pure-deletion primary; the anchor is then
      // left unrefreshed, matching today's behavior rather than risking a
      // wrong or empty-text anchor.
      const refreshedAnchor = refreshedAnchorForMultiRegionApply(
        annotation.anchor,
        proposed,
        result.applied,
      )
      updateAnnotation(annotation.id, {
        status: 'applied',
        ...(refreshedAnchor ? { anchor: refreshedAnchor } : {}),
      })
      // Every accepted edit may have been a no-op (applied is empty): the doc
      // did not change, so record no version commit and say so — a "0 changes"
      // success toast or an empty ledger commit would fabricate history.
      if (result.applied.length > 0) {
        recordApplyCommit(
          result.applied
            .map((ap) => ap.blockId)
            .filter((blockId): blockId is string => Boolean(blockId)),
        )
        useToastStore.getState().addToast(
          `Applied ${result.applied.length} change${result.applied.length > 1 ? 's' : ''}`,
          'success',
        )
      } else {
        useToastStore.getState().addToast(
          'No changes were needed — the text already matches',
          'info',
        )
        // No commit will be recorded for a no-op apply — a declared fact with
        // no real version to attribute it to would be a fabricated record.
        pendingInvariantRef.current = null
      }
      setShowDiffModal(false)
      setPendingHandler(null)
      return
    }

    // Honor an explicit empty selection from the modal (defensive — single-edit
    // modals can't normally produce one).
    if (acceptedIds && acceptedIds.length === 0) {
      pendingInvariantRef.current = null
      setShowDiffModal(false)
      setPendingHandler(null)
      return
    }

    const edit = annotation.resolution?.suggestedEdit
    if (!edit || !view) return

    // Same fail-closed fingerprint/block-scoped-recovery validation the
    // multi-region path gets from applyProposedEdits — this single-suggestion
    // path previously dispatched a raw, unvalidated replaceWith, so a document
    // that changed since the edit was proposed could silently misapply.
    const result = applySingleEdit(view, {
      id: annotation.id,
      from: edit.from,
      to: edit.to,
      newText: edit.newText,
      targetText: annotation.anchor.text,
      blockId: blockIdAtPos(view.state.doc, edit.from) ?? undefined,
    })
    if (!result.ok) {
      pendingInvariantRef.current = null
      useToastStore.getState().addToast(result.reason, 'error')
      setShowDiffModal(false)
      setPendingHandler(null)
      return
    }
    if (result.applied.length === 0) {
      // No-op: the target already matches newText — nothing was dispatched,
      // so recording a version/change entry would fabricate history.
      pendingInvariantRef.current = null
      updateAnnotation(annotation.id, { status: 'applied' })
      useToastStore.getState().addToast(
        'No changes were needed — the text already matches',
        'info',
      )
      setShowDiffModal(false)
      setPendingHandler(null)
      return
    }
    const applied = result.applied[0]

    // Record the change
    useChangesStore.getState().addEntry({
      id: generateId(),
      documentId: annotation.documentId,
      rootAnnotationId,
      annotationId: annotation.id,
      timestamp: Date.now(),
      description: `${annotation.type}: ${annotation.transcript.slice(0, 50)}`,
      beforeSlice: applied.targetText,
      afterSlice: applied.newText,
      from: applied.from,
      to: applied.to,
      pmStep: null,
      undone: false,
    })

    if (changeSetId) {
      useChangesStore.getState().updateChangeSetStatus(changeSetId, 'approved')
    }

    updateAnnotation(annotation.id, {
      status: 'applied',
      anchor: refreshAnchorAfterApply(annotation.anchor, applied),
    })
    recordApplyCommit(applied.blockId ? [applied.blockId] : [])

    // Apply uncertainty highlights to the newly inserted text
    const newTo = applied.from + applied.newText.length
    if (annotation.resolution?.logprobs?.content) {
      applyUncertaintyFromLogprobs(view, annotation.resolution.logprobs, applied.from, newTo)
    } else if (annotation.resolution?.uncertaintyFlags?.length) {
      applyUncertaintyFromFlags(view, annotation.resolution.uncertaintyFlags, applied.from, newTo)
    }

    // Ingest the edit into GraphRAG (non-blocking)
    ingestEditEpisode(
      annotation.id,
      applied.targetText,
      applied.newText,
      `${annotation.type}: ${annotation.transcript.slice(0, 50)}`,
    )

    // GraphRAG-powered cascade check (falls back to keyword if MCP unavailable)
    runCascadeCheck(view, applied.targetText, applied.newText, applied.from).then(
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
    const modalGated = opensCommitModal(handler, Boolean(annotation.resolution?.suggestedEdit) && Boolean(view))
    if (auditId && approvalAction) {
      recordHumanDecision(auditId, approvalAction)
    } else if (!auditId && approvalAction && annotation.resolution?.auditFailed && !modalGated) {
      // Known failure (not just "write still in flight") — the human-oversight
      // override record has nowhere to link to. Warn instead of skipping
      // silently — see #77. Skipped for handlers that only open the commit
      // modal here (no decision has happened yet): recordApplyCommit's own
      // toast covers those once the user actually confirms, so this doesn't
      // fire early for a decision that hasn't happened, or double up with
      // that toast on confirm.
      useToastStore.getState().addToast(
        'This decision could not be recorded — the audit trail for this resolution failed to save.',
        'error'
      )
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
          // AI content insert — stamped so it never triggers a direct-edit offer.
          tr.setMeta(AI_APPLY_META, true)
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
        // Idempotency guard: a double-click fires two synchronous onClick
        // calls before React can re-render with the new status, but each
        // call reads the STORE (not the closure-captured `annotation` prop)
        // fresh — so the second call correctly sees what the first one just
        // wrote and no-ops, rather than firing the invariant-resolve network
        // call (below) twice for one user action.
        if (useAnnotationStore.getState().getById(annotation.id)?.status === 'dismissed') break
        updateAnnotation(annotation.id, { status: 'dismissed' })
        // Dismiss — including "Got it" and "Keep it" — is the reader saying
        // they are finished with this thread, so the card gets out of the way.
        // Nothing is destroyed: it stays in the store and in the audit trail,
        // and "Show N resolved" brings it straight back.
        //
        // Applying deliberately does NOT hide. The reader has just changed
        // their document and wants to see that it registered — the "Applied"
        // badge, the cascade list, the change entry. Hiding there made the
        // card vanish mid-action with no acknowledgement, which
        // cascade-review.spec.ts caught by asserting that badge. They can
        // collapse or dismiss it afterwards, on their own timing.
        useAnnotationStore.getState().setHidden(annotation.id, true)
        // The floating answer panel renders for whatever annotation is active,
        // so hiding the row left the popup sitting on screen taking up space.
        // "I am finished with this" has to mean the answer goes away.
        useAnnotationStore.getState().setActive(null)
        if (changeSetId) {
          useChangesStore.getState().updateChangeSetStatus(changeSetId, 'rejected')
        }
        if (view) {
          removeAnnotationDecoration(view, annotation.id)
        }
        // Dismissing an invariant-check flag ("Nevermind") also resolves the
        // underlying ledger row (#35), so the doc-CI lane stops re-flagging
        // it. No-op for any other annotation type. Fire-and-forget from this
        // handler's perspective — the helper itself only prunes dedup memory
        // once the resolve genuinely succeeds.
        resolveInvariantFlagOnDismiss(annotation)
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
  // Document Invariant Ledger default: derived from the primary change only
  // (a cascade's collateral edit isn't the fact the user just declared).
  const primaryEdit = resolutionEdits?.find((e) => e.relation === 'primary') ?? null
  const primaryBlockId = primaryEdit
    ? (primaryEdit.blockId ?? null)
    : view && annotation.resolution?.suggestedEdit
      ? blockIdAtPos(view.state.doc, annotation.resolution.suggestedEdit.from)
      : null
  const primaryStatement = (
    primaryEdit ? primaryEdit.newText : annotation.resolution?.suggestedEdit?.newText ?? ''
  ).trim()
  const invariantDefault =
    primaryStatement.length > 0
      ? { statement: primaryStatement, blockIds: primaryBlockId ? [primaryBlockId] : [] }
      : null

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

  // Pre-decision blast-radius preview: what else the doc graph says this
  // annotation's own anchor touches, shown read-only ABOVE the action
  // controls so the human sees it before committing rather than after (the
  // apply handler's `runCascadeCheck` toast below stays the post-apply check
  // — this doesn't replace it).
  //
  // Three outcomes, not two. A cold graph must render NOTHING: "nothing
  // depends on this" is a claim about the document, and making it on the
  // strength of an unbuilt index would be false rather than cautious.
  const blast = view
    ? previewBlastRadiusDetail(view.state, annotation.anchor.from)
    : { passages: [], suppressed: 0, graphUnavailable: true }
  const blastRadius = blast.passages

  /** Send the reader to a related passage and mark where they landed. */
  const goToPassage = (blockId: string) => {
    const currentView = useEditorStore.getState().view
    if (!currentView) return
    const found = findBlockById(currentView.state.doc, blockId)
    if (!found) return
    scrollToPos(currentView, found.pos)
    pulseBlock(currentView, blockId)
  }

  // Opt-in second opinion: the heuristic list is the ONLY thing ever shown
  // until the reader explicitly clicks. On failure (throw, network, zero
  // verdicts) every passage is left exactly as the heuristic rendered it —
  // a failed second opinion must never destroy the first one.
  const checkRelatedPassages = async () => {
    if (isJudgingPassages || blastRadius.length === 0) return
    setIsJudgingPassages(true)
    try {
      const seed: JudgeSeed = { text: annotation.anchor.text, headingPath: [] }
      const config = useSettingsStore.getState().llmConfig
      const verdicts = await judgeRelatedPassages(seed, blastRadius, config)
      const byBlock = new Map<string, PassageVerdict>()
      blastRadius.forEach((passage, i) => {
        const v = verdicts.get(i)
        if (v) byBlock.set(passage.blockId, v)
      })
      setPassageVerdicts(byBlock)
    } catch (err) {
      console.error('Related-passage judge failed:', err)
      useToastStore.getState().addToast(
        'Checking these passages failed — the original list is unchanged.',
        'error',
      )
    } finally {
      setIsJudgingPassages(false)
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
        invariantDefault={invariantDefault}
        onConfirm={(ids, invariant) => {
          // Confirm: the live statuses stand — drop the snapshot, no restore.
          // Flush the buffered modal decisions (one event per decided edit).
          modalDecisionsRef.current?.confirm()
          modalDecisionsRef.current = null
          commitSnapshotRef.current = null
          const primaryId = primaryEdit?.id ?? annotation.id
          pendingInvariantRef.current =
            invariant && shouldCaptureInvariant(ids, primaryId) ? invariant : null
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
    {blastRadius.length > 0 && (
      <div
        aria-label={`Blast radius preview (${blastRadius.length})`}
        className="mt-3 mx-1 p-3 border border-border rounded-xl bg-warm/40"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-mono font-medium text-muted-foreground">
            Touches {blastRadius.length} other passage{blastRadius.length !== 1 ? 's' : ''}
          </p>
          {judgeEnabled && (
            <button
              type="button"
              onClick={checkRelatedPassages}
              disabled={isJudgingPassages}
              aria-busy={isJudgingPassages}
              className="shrink-0 px-2 py-1 text-[10px] font-mono font-medium rounded-md border border-border/60 bg-warm/60 text-muted-foreground transition-colors hover:bg-warm hover:border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isJudgingPassages ? 'Checking…' : 'Check these'}
            </button>
          )}
        </div>
        <div className="mt-1.5 flex flex-col gap-1.5">
          {blastRadius.map((passage) => {
            const verdict = passageVerdicts?.get(passage.blockId) ?? null
            // Never removed — struck through / dimmed and labelled with the
            // judge's reason. The reader asked a question and deserves to
            // see the answer, not have rows silently vanish.
            const rejected = verdict !== null && !verdict.related
            return (
              <button
                key={passage.blockId}
                type="button"
                onClick={() => goToPassage(passage.blockId)}
                // The machine provenance stays one hover away — `why` is the
                // human sentence, `whyPath` is what an auditor checks it against.
                title={passage.whyPath}
                aria-label={`Go to related passage${
                  passage.headingPath.length > 0 ? ` in ${passage.headingPath.join(' › ')}` : ''
                }: ${passage.text}${verdict ? ` — second opinion: ${verdict.related ? 'related' : 'not related'}, ${verdict.reason}` : ''}`}
                className={`w-full text-left rounded-lg border border-border/60 bg-warm/60 px-2.5 py-1.5 transition-colors hover:bg-warm hover:border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                  rejected ? 'opacity-50' : ''
                }`}
              >
                <p className="text-[10px] font-mono text-muted-foreground">
                  {passage.why}
                  {passage.headingPath.length > 0 && ` · ${passage.headingPath.join(' › ')}`}
                </p>
                <p className={`text-xs text-muted-foreground leading-snug ${rejected ? 'line-through' : ''}`}>
                  {passage.text}
                </p>
                {verdict && (
                  <p
                    className={`mt-1 text-[10px] font-mono ${
                      verdict.related ? 'text-muted-foreground' : 'text-muted-foreground/80'
                    }`}
                  >
                    {verdict.related ? 'Confirmed related: ' : 'Judge says not related: '}
                    {verdict.reason}
                  </p>
                )}
              </button>
            )
          })}
        </div>
      </div>
    )}
    {blastRadius.length === 0 && !blast.graphUnavailable && blast.suppressed > 0 && (
      // Said plainly rather than left blank. A blank card and a card that has
      // checked are indistinguishable to a reader, and the reader is the one
      // deciding whether to apply the edit.
      <p
        aria-label="Blast radius preview (none)"
        className="mt-3 mx-1 px-3 py-2 text-[10px] font-mono text-muted-foreground border border-dashed border-border/60 rounded-xl"
      >
        Nothing else in this document depends on this passage
        {` (${blast.suppressed} nearby passage${blast.suppressed === 1 ? '' : 's'} checked).`}
      </p>
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
                ? 'bg-warm text-muted-foreground hover:bg-border'
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
            if (isSimplifying) return
            setIsSimplifying(true)
            const conversationSnapshot = annotation.conversation
            try {
              const result = await simplifyThread(annotation)
              if (result.requestFailed) {
                useToastStore.getState().addToast(
                  'Simplifying this thread failed — the conversation was left unchanged.',
                  'error'
                )
                return
              }
              // The conversation is a store-owned reference that is only
              // reassigned when its own content changes (annotationStore's
              // plain `update` spreads the patch over the existing
              // annotation, so an unrelated field write leaves `conversation`
              // pointing at the same array). A reference mismatch here means
              // another reply (or another simplify) landed on this
              // annotation while this request was in flight — applying the
              // stale summary on top would silently discard that write.
              const live = useAnnotationStore.getState().getById(annotation.id)
              if (!live) {
                // Nothing to retry — the annotation itself is gone.
                return
              }
              if (live.conversation !== conversationSnapshot) {
                useToastStore.getState().addToast(
                  'This conversation changed while simplifying — try again.',
                  'error'
                )
                return
              }
              updateAnnotation(annotation.id, {
                conversation: [{
                  id: generateId(),
                  role: 'agent',
                  content: result.content,
                  suggestedEdit: null,
                  timestamp: Date.now(),
                }],
              })
            } catch (err) {
              console.error('Simplify thread failed unexpectedly:', err)
              useToastStore.getState().addToast(
                'Simplifying this thread failed — the conversation was left unchanged.',
                'error'
              )
            } finally {
              setIsSimplifying(false)
            }
          }}
          disabled={isSimplifying}
          className="px-3 py-1.5 text-xs font-medium rounded bg-warm text-muted-foreground hover:bg-border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSimplifying ? 'Simplifying…' : 'Simplify thread'}
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
