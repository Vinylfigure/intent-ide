'use client'

import { useMemo, useState } from 'react'
import { useChangesStore } from '@/stores/changesStore'
import { useDocumentStore } from '@/stores/documentStore'
import { ChangeEntry } from './ChangeEntry'
import type { ChangeSetStatus } from '@/lib/changes/changeLog'

const STATUS_OPTIONS: ChangeSetStatus[] = ['pending', 'approved', 'modified', 'rejected']

const STATUS_STYLES: Record<ChangeSetStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  modified: 'bg-blue-100 text-blue-800',
  rejected: 'bg-red-100 text-red-800',
}

export function ChangesPanel() {
  const entries = useChangesStore((s) => s.entries)
  const changeSets = useChangesStore((s) => s.changeSets)
  const updateChangeSetStatus = useChangesStore((s) => s.updateChangeSetStatus)
  const activeDocumentId = useDocumentStore((s) => s.activeDocumentId)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const { documentChangeSets, directEdits } = useMemo(() => {
    const documentEntries = entries.filter((entry) => entry.documentId === activeDocumentId)
    const grouped = changeSets
      .filter((changeSet) => changeSet.documentId === activeDocumentId)
      .sort((a, b) => b.updatedAt - a.updatedAt)

    return {
      documentChangeSets: grouped.map((changeSet) => ({
        ...changeSet,
        entries: documentEntries.filter((entry) => changeSet.changeEntryIds.includes(entry.id)),
      })),
      directEdits: documentEntries.filter((entry) => !entry.rootAnnotationId),
    }
  }, [activeDocumentId, changeSets, entries])

  if (documentChangeSets.length === 0 && directEdits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center px-6">
        <div className="w-12 h-12 rounded-full bg-warm flex items-center justify-center mb-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </div>
        <p className="text-sm text-muted">No review changes yet</p>
        <p className="text-xs text-muted/60 mt-1">Grouped AI change sets and direct edits will appear here</p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4 h-full overflow-y-auto">
      <div className="rounded-[22px] border border-border/70 bg-white/78 overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-border/70 bg-gradient-to-r from-warm/50 to-white/70">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
              Change-set review
            </h2>
            <span className="status-chip px-2 py-0.5 rounded-full text-[10px] font-mono">
              {documentChangeSets.length} grouped
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Review at the thread level here. Raw audit events remain available in the Audit tab.
          </p>
        </div>

        <div className="divide-y divide-border">
          {documentChangeSets.map((changeSet) => {
            const expanded = expandedIds.has(changeSet.id)
            return (
              <div key={changeSet.id} className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <button
                    onClick={() => {
                      setExpandedIds((prev) => {
                        const next = new Set(prev)
                        if (next.has(changeSet.id)) next.delete(changeSet.id)
                        else next.add(changeSet.id)
                        return next
                      })
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono ${STATUS_STYLES[changeSet.status]}`}>
                        {changeSet.status}
                      </span>
                      <span className="text-sm font-medium text-ink">{changeSet.title}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {changeSet.annotationIds.length} annotations, {changeSet.entries.length} applied changes, {changeSet.auditRecordIds.length} audit events
                    </p>
                  </button>

                  <div className="flex flex-wrap justify-end gap-1">
                    {STATUS_OPTIONS.map((status) => (
                      <button
                        key={status}
                        onClick={() => updateChangeSetStatus(changeSet.id, status)}
                        className={`px-2.5 py-1 text-[10px] font-mono rounded-full border transition-colors ${
                          changeSet.status === status
                            ? 'border-accent bg-accent/10 text-accent shadow-sm'
                            : 'border-border/70 text-muted-foreground hover:text-ink hover:bg-warm/70'
                        }`}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                </div>

                {expanded && (
                  <div className="mt-3 rounded-2xl border border-border/70 bg-warm/15 overflow-hidden">
                    {changeSet.entries.length > 0 ? (
                      <div className="divide-y divide-border">
                        {changeSet.entries.map((entry) => (
                          <ChangeEntry key={entry.id} entry={entry} />
                        ))}
                      </div>
                    ) : (
                      <p className="px-4 py-3 text-xs text-muted-foreground">
                        No applied document changes in this thread yet.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {directEdits.length > 0 && (
        <div className="rounded-[22px] border border-border/70 bg-white/78 overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-border/70 bg-gradient-to-r from-warm/50 to-white/70">
            <h2 className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
              Direct edits
            </h2>
          </div>
          <div className="divide-y divide-border">
            {directEdits.map((entry) => (
              <ChangeEntry key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
