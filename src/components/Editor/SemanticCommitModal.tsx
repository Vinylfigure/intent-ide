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
  onConfirm: () => void
  onCancel: () => void
  /** Provocation from MADS Troublemaker — shown as amber callout, gates Apply for high-risk */
  provocation?: string | null
  /** Whether this edit came through MADS (multi-agent debate) — indicates higher scrutiny needed */
  isHighRisk?: boolean
}

/**
 * Plan/Act gatekeeper modal.
 * Shows a diff for each proposed change and wraps the apply action
 * in a Confirmation HITL gate.
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
}: SemanticCommitModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const [acknowledged, setAcknowledged] = useState(false)

  // Apply is gated when there's a provocation on a high-risk edit
  const needsAcknowledgement = isHighRisk && !!provocation && !acknowledged

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
          description={`${changes.length} change${changes.length !== 1 ? 's' : ''} will be applied to the document.${isHighRisk ? ' This edit was flagged for extra review.' : ''}`}
          confirmLabel={needsAcknowledgement ? 'Acknowledge risk first' : 'Apply All Changes'}
          cancelLabel="Discard"
          variant="destructive"
          onConfirm={needsAcknowledgement ? () => {} : onConfirm}
          onCancel={onCancel}
        >
          <div className="semantic-commit-diffs">
            {changes.map((change) => (
              <DiffViewer
                key={change.id}
                before={change.before}
                after={change.after}
                title={change.label}
              />
            ))}
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
