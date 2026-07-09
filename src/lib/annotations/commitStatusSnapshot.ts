import type { EditorView } from 'prosemirror-view'
import {
  getProposedAnchors,
  setProposedEditStatus,
} from '@/lib/prosemirror/plugins/proposedChangePlugin'
import type { ProposedEdit, ProposedEditStatus } from './types'

/**
 * Commit-modal status bookkeeping. The proposedChange plugin's statuses are
 * the single pre-apply source of truth across every review surface (inline
 * control, CascadeList, SemanticCommitModal), and the modal writes toggles
 * through live — so opening the modal must snapshot the statuses first, and
 * CANCEL must put them back, or an abandoned review session leaks its toggles
 * into the inline surfaces.
 */
export type CommitStatusSnapshot = Record<string, ProposedEditStatus>

/**
 * Called when the modal OPENS. Two jobs, in order:
 * 1. Snapshot the plugin's current statuses for the involved edit ids (the
 *    restore target for cancel).
 * 2. Seed the modal's optional-severity pre-rejections INTO the plugin —
 *    accept-all defaults to must + probably, so still-pending optional
 *    cascades flip to rejected in the plugin too, and the inline control /
 *    CascadeList agree with the modal from the moment it opens (previously
 *    the modal showed them rejected while the plugin still said pending).
 */
export function openCommitReview(view: EditorView, edits: ProposedEdit[]): CommitStatusSnapshot {
  const anchors = getProposedAnchors(view.state)
  const snapshot: CommitStatusSnapshot = {}
  for (const e of edits) {
    const a = anchors.get(e.id)
    if (a) snapshot[e.id] = a.status
  }
  for (const e of edits) {
    if (e.relation !== 'cascade' || e.severity !== 'optional') continue
    if (anchors.get(e.id)?.status === 'pending') {
      setProposedEditStatus(view, e.id, 'rejected')
    }
  }
  return snapshot
}

/**
 * Called on modal CANCEL: restore every snapshotted status (toggles made while
 * the modal was open — including the open-time optional pre-rejections — must
 * not leak). On CONFIRM this is NOT called; the live statuses stand.
 */
export function restoreCommitReview(view: EditorView, snapshot: CommitStatusSnapshot): void {
  for (const [id, status] of Object.entries(snapshot)) {
    // Read fresh per id — each restore dispatch advances the state.
    const current = getProposedAnchors(view.state).get(id)
    if (current && current.status !== status) {
      setProposedEditStatus(view, id, status)
    }
  }
}
