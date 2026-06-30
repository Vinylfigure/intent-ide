'use client'

import { useRef, useState } from 'react'
import { DiffViewer } from './DiffViewer'
import { Confirmation } from '@/components/ui/Confirmation'

interface SemanticChange {
  id: string
  label: string
  before: string
  after: string
}

interface SemanticCommitModalProps {
  changes: SemanticChange[]
  /** Receives the ids of the changes the user chose to apply. */
  onConfirm: (acceptedIds: string[]) => void
  onCancel: () => void
  /** Provocation from MADS Troublemaker — shown as amber callout, gates Apply for high-risk */
  provocation?: string | null
  /** Whether this edit came through MADS (multi-agent debate) — indicates higher scrutiny needed */
  isHighRisk?: boolean
  /** Change ids already rejected inline — pre-toggled off so the two surfaces agree. */
  initialRejected?: Record<string, boolean>
}

/**
 * Plan/Act gatekeeper modal.
 * Shows a diff for each proposed change and wraps the apply action
 * in a Confirmation HITL gate. When there is more than one change, each gets an
 * Accept/Reject toggle and only the accepted subset is applied.
 *
 * For high-risk edits (MADS with unresolved provocations), the Apply button
 * is gated — user must acknowledge the provocation first.
 */
export function SemanticCommitModal({
  changes,
  onConfirm,
  onCancel,
  provocation,
  isHighRisk = false,
  initialRejected,
}: SemanticCommitModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  // Per-change selection (default: all accepted, minus anything rejected inline).
  // Only surfaced when >1 change.
  const [rejected, setRejected] = useState<Record<string, boolean>>(
    () => initialRejected ?? {},
  )

  const multi = changes.length > 1
  const acceptedIds = changes.filter((c) => !rejected[c.id]).map((c) => c.id)

  // Apply is gated when there's a provocation on a high-risk edit, or nothing is selected.
  const needsAcknowledgement = isHighRisk && !!provocation && !acknowledged
  const nothingSelected = acceptedIds.length === 0
  const blocked = needsAcknowledgement || nothingSelected

  const confirmLabel = needsAcknowledgement
    ? 'Acknowledge risk first'
    : nothingSelected
      ? 'Select at least one'
      : multi
        ? `Apply ${acceptedIds.length} change${acceptedIds.length !== 1 ? 's' : ''}`
        : 'Apply All Changes'

  const toggle = (id: string) =>
    setRejected((r) => ({ ...r, [id]: !r[id] }))

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={(e) => {
        if (e.target === backdropRef.current) onCancel()
      }}
    >
      <div className="semantic-commit-modal">
        <Confirmation
          title="Review Semantic Commit"
          description={`${changes.length} change${changes.length !== 1 ? 's' : ''} proposed.${multi ? ' Accept or reject each, then apply your selection.' : ''}${isHighRisk ? ' This edit was flagged for extra review.' : ''}`}
          confirmLabel={confirmLabel}
          cancelLabel="Discard"
          variant="destructive"
          onConfirm={blocked ? () => {} : () => onConfirm(acceptedIds)}
          onCancel={onCancel}
        >
          <div className="semantic-commit-diffs">
            {changes.map((change) => {
              const isRejected = !!rejected[change.id]
              return (
                <div
                  key={change.id}
                  className={isRejected ? 'opacity-50' : undefined}
                >
                  {multi && (
                    <div className="flex items-center justify-end gap-1.5 mb-1">
                      <button
                        onClick={() => !isRejected || toggle(change.id)}
                        className={`px-2 py-0.5 text-xs font-medium rounded border transition-colors ${
                          !isRejected
                            ? 'border-green-400 bg-green-50 text-green-700'
                            : 'border-border text-muted hover:text-ink'
                        }`}
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => isRejected || toggle(change.id)}
                        className={`px-2 py-0.5 text-xs font-medium rounded border transition-colors ${
                          isRejected
                            ? 'border-red-400 bg-red-50 text-red-700'
                            : 'border-border text-muted hover:text-ink'
                        }`}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                  <DiffViewer
                    before={change.before}
                    after={change.after}
                    title={change.label}
                  />
                </div>
              )
            })}
          </div>

          {/* Provocation callout */}
          {provocation && (
            <div className="mt-3 p-3 border border-amber-300 bg-amber-50 rounded-md">
              <div className="flex items-start gap-2">
                <span className="text-amber-600 text-sm font-bold shrink-0">⚠</span>
                <div className="flex-1">
                  <p className="text-xs font-mono font-medium text-amber-800 mb-1">AI Challenge</p>
                  <p className="text-sm text-amber-900 italic leading-relaxed">{provocation}</p>
                  {!acknowledged && isHighRisk && (
                    <button
                      onClick={() => setAcknowledged(true)}
                      className="mt-2 px-3 py-1 text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300 rounded hover:bg-amber-200 transition-colors"
                    >
                      I&apos;ve considered this — proceed
                    </button>
                  )}
                  {acknowledged && (
                    <span className="mt-2 inline-block text-xs text-amber-600 font-mono">Acknowledged</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </Confirmation>
      </div>
    </div>
  )
}
