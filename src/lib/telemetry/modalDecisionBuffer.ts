import type { ProposedEditStatus } from '@/lib/annotations/types'
import {
  recordCascadeStatusChange,
  type RecordDeps,
  type ReviewedEditLike,
} from './cascadeCalibration'

/**
 * Modal-source telemetry buffering. Toggles made INSIDE an open commit review
 * are provisional — the user can flip a decision back and forth, or abandon
 * the whole session with Cancel. Recording each toggle live would inflate the
 * calibration counts with flip noise and count decisions that were never
 * committed. So the modal buffers: last decision per edit id, flushed as ONE
 * event per edit on CONFIRM (guarded against the modal-OPEN-time status, so a
 * toggle that ends where it started records nothing), discarded on cancel.
 *
 * Inline and CascadeList sites are unaffected — their single clicks are final
 * decisions and keep recording immediately.
 */

/** The per-edit metadata the flush needs (status comes from the open-time snapshot). */
export type BufferedEditMeta = Omit<ReviewedEditLike, 'status'>

export interface ModalDecisionBuffer {
  /** Record the latest provisional decision for an edit (last one wins). */
  toggle(id: string, status: 'accepted' | 'rejected'): void
  /** CONFIRM: flush one event per decided edit, then clear. */
  confirm(deps?: RecordDeps): void
  /** CANCEL: discard everything — an abandoned review records nothing. */
  cancel(): void
}

/**
 * @param editsById   metadata for the edits under review; toggles for unknown
 *                    ids (e.g. single-edit fallback rows) are ignored.
 * @param openStatuses plugin statuses at modal-open time — the flush guard
 *                    baseline (the live plugin status is useless here: the
 *                    modal writes toggles through, so by confirm time it
 *                    always equals the last toggle).
 */
export function createModalDecisionBuffer(
  editsById: ReadonlyMap<string, BufferedEditMeta>,
  openStatuses: ReadonlyMap<string, ProposedEditStatus>,
): ModalDecisionBuffer {
  const last = new Map<string, 'accepted' | 'rejected'>()
  return {
    toggle(id, status) {
      if (editsById.has(id)) last.set(id, status)
    },
    confirm(deps) {
      try {
        for (const [id, status] of last) {
          const meta = editsById.get(id)
          if (!meta) continue
          recordCascadeStatusChange(
            { ...meta, status: openStatuses.get(id) ?? 'pending' },
            status,
            'modal',
            deps,
          )
        }
      } finally {
        last.clear()
      }
    },
    cancel() {
      last.clear()
    },
  }
}
