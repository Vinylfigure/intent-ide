'use client'

import { useEditorStore } from '@/stores/editorStore'
import { useDocGraphStore } from '@/stores/docGraphStore'
import { getProposedAnchors, setProposedEditStatus } from '@/lib/prosemirror/plugins/proposedChangePlugin'
import { findEdgePath, formatEdgePath } from '@/lib/graphrag/docGraph'
import { recordCascadeStatusChange } from '@/lib/telemetry/cascadeCalibration'
import type { Annotation, CascadeSeverity, ProposedEdit, ProposedEditStatus } from '@/lib/annotations/types'
import { SEVERITY_LABELS, SEVERITY_ORDER } from '@/lib/annotations/types'

interface CascadeListProps {
  annotation: Annotation
}

const STATUS_PILL_LABELS: Record<ProposedEditStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  rejected: 'Rejected',
}

const STATUS_PILL_STYLES: Record<ProposedEditStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  accepted: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-stone-200 text-stone-700',
}

const SEVERITY_PILL_STYLES: Record<CascadeSeverity, string> = {
  must: 'bg-red-100 text-red-800',
  probably: 'bg-amber-100 text-amber-800',
  optional: 'bg-stone-200 text-stone-700',
}

function truncate(text: string, max = 80): string {
  if (text.length <= max) return text
  return text.slice(0, max).trimEnd() + '…'
}

/**
 * Persistent "this change affects N other section(s)" list for a resolved
 * annotation's multi-region proposed edits. Each cascade edit row scrolls the
 * editor to its live region (read from the proposed-change plugin's mapped
 * anchors, not the stale stored positions) and offers Accept / Reject status
 * toggles. Status reflects the live plugin anchor when available, falling back
 * to the stored edit status.
 */
export function CascadeList({ annotation }: CascadeListProps) {
  const view = useEditorStore((s) => s.view)
  const graph = useDocGraphStore((s) => s.graph)

  // Only show while the resolution is under review. Once applied/dismissed the
  // plugin anchors are cleared, so live status would be unreadable and the
  // Accept/Reject buttons would no-op — hide the list to avoid stale "Pending".
  const edits = annotation.resolution?.edits
  if (annotation.status !== 'resolved' || !edits || edits.length <= 1) return null

  const cascades = edits
    .filter((e) => e.relation === 'cascade')
    .sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.from - b.from,
    )
  if (cascades.length === 0) return null

  const count = cascades.length
  const primaryBlockId = edits.find((e) => e.relation === 'primary')?.blockId ?? null

  /**
   * "Why this proposal?" — the graph path linking the primary edit's block to
   * this cascade's block, e.g. `linked via references ("Total Budget")`.
   * Returns null (renders nothing) whenever the graph, block ids, or a path
   * are unavailable — never blocks the row.
   */
  const whyLine = (edit: ProposedEdit): string | null => {
    if (!graph || !primaryBlockId || !edit.blockId) return null
    try {
      const path = findEdgePath(graph, primaryBlockId, edit.blockId)
      if (!path || path.length === 0) return null
      return `linked via ${formatEdgePath(path)}`
    } catch {
      return null
    }
  }

  /** Read the live (transaction-mapped) status for an edit, else its stored status. */
  const liveStatus = (edit: ProposedEdit): ProposedEditStatus => {
    if (!view) return edit.status
    return getProposedAnchors(view.state).get(edit.id)?.status ?? edit.status
  }

  /** Scroll the editor to the edit's live region (AnnotationMap scroll pattern). */
  const scrollToEdit = (edit: ProposedEdit) => {
    if (!view) return
    const livePos = getProposedAnchors(view.state).get(edit.id)?.from ?? edit.from
    const maxPos = view.state.doc.content.size
    const safePos = Math.min(livePos, maxPos)
    try {
      const coords = view.coordsAtPos(safePos)
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
      // Position may be out of range after a concurrent doc change — ignore.
    }
  }

  const setStatus = (edit: ProposedEdit, status: ProposedEditStatus) => {
    if (!view) return
    if (status === 'accepted' || status === 'rejected') {
      // Calibration telemetry (metadata only): guard against the CURRENT live
      // status so a no-op click never double-counts.
      const current = getProposedAnchors(view.state).get(edit.id) ?? edit
      recordCascadeStatusChange(current, status, 'list')
    }
    setProposedEditStatus(view, edit.id, status)
  }

  return (
    <div
      data-cascade-list={annotation.id}
      tabIndex={-1}
      aria-label={`Affected sections for this change (${count})`}
      className="mt-3 mx-1 p-3 border border-amber-300 bg-amber-50 rounded-xl shadow-sm focus:outline-none"
    >
      {/* Header */}
      <div className="flex items-start gap-2 mb-2">
        <span className="text-amber-600 text-xs font-bold shrink-0">⤳</span>
        <p className="text-[10px] font-mono font-medium text-amber-800">
          This change affects {count} other section{count !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Cascade rows */}
      <div className="flex flex-col gap-1.5">
        {cascades.map((edit) => {
          const status = liveStatus(edit)
          const why = whyLine(edit)
          return (
            <div
              key={edit.id}
              className="rounded-lg border border-amber-200 bg-white/70 px-2.5 py-1.5"
            >
              <button
                onClick={() => scrollToEdit(edit)}
                title="Click to scroll to this section"
                className="w-full text-left flex items-start gap-2 cursor-pointer group"
              >
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[9px] font-mono shrink-0 ${SEVERITY_PILL_STYLES[edit.severity]}`}
                >
                  {SEVERITY_LABELS[edit.severity]}
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[9px] font-mono shrink-0 ${STATUS_PILL_STYLES[status]}`}
                >
                  {STATUS_PILL_LABELS[status]}
                </span>
                <span className="text-xs text-ink/80 leading-snug group-hover:text-ink">
                  {truncate(edit.reason || edit.targetText || 'Downstream change')}
                  {edit.evidence && (
                    <span className="text-ink/50">
                      {' '}· cites &ldquo;{truncate(edit.evidence.quotedText, 40)}&rdquo;
                    </span>
                  )}
                </span>
              </button>

              {/* "Why this proposal?" — graph path from the primary edit's block */}
              {why && (
                <p className="mt-0.5 pl-1 text-[10px] font-mono text-ink/50 truncate" title={why}>
                  {why}
                </p>
              )}

              {/* Accept / Reject status toggles */}
              <div className="mt-1 flex items-center gap-1 pl-1">
                <button
                  onClick={() => setStatus(edit, 'accepted')}
                  disabled={status === 'accepted'}
                  className="px-2 py-0.5 text-[10px] font-mono rounded text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Accept
                </button>
                <button
                  onClick={() => setStatus(edit, 'rejected')}
                  disabled={status === 'rejected'}
                  className="px-2 py-0.5 text-[10px] font-mono rounded text-stone-600 hover:bg-stone-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Reject
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
