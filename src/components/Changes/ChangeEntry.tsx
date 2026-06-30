'use client'

import { useState } from 'react'
import { useChangesStore } from '@/stores/changesStore'
import { DiffView } from './DiffView'
import type { ChangeEntry as ChangeEntryType } from '@/lib/changes/changeLog'

interface ChangeEntryProps {
  entry: ChangeEntryType
}

export function ChangeEntry({ entry }: ChangeEntryProps) {
  const undoEntry = useChangesStore((s) => s.undoEntry)
  const [expanded, setExpanded] = useState(false)

  const timeAgo = getTimeAgo(entry.timestamp)
  const hasDiff = !!(entry.beforeSlice || entry.afterSlice)
  const preview = entry.afterSlice
    ? entry.afterSlice.split('\n')[0].slice(0, 60)
    : entry.beforeSlice
      ? entry.beforeSlice.split('\n')[0].slice(0, 60)
      : null

  return (
    <div className={`px-4 py-3 ${entry.undone ? 'opacity-50' : ''}`}>
      {/* Header row — always visible */}
      <div
        className={`flex items-center justify-between gap-2 ${hasDiff ? 'cursor-pointer' : ''}`}
        onClick={() => hasDiff && setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 min-w-0">
          {hasDiff && (
            <span className="text-[10px] text-muted-foreground shrink-0">
              {expanded ? '\u25BC' : '\u25B6'}
            </span>
          )}
          <span className="text-xs font-medium text-ink truncate">{entry.description}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {entry.from != null && entry.to != null && (
            <span className="text-[9px] font-mono text-muted-foreground/60">
              {entry.from}:{entry.to}
            </span>
          )}
          <span className="status-chip px-2 py-0.5 rounded-full text-[10px] font-mono">{timeAgo}</span>
        </div>
      </div>

      {/* Collapsed preview */}
      {!expanded && preview && (
        <p className="mt-1 ml-5 text-[11px] font-mono text-muted-foreground/60 truncate">
          {entry.afterSlice ? '+' : '-'} {preview}
        </p>
      )}

      {/* Expanded diff */}
      {expanded && hasDiff && (
        <div className="mt-2">
          <DiffView before={entry.beforeSlice} after={entry.afterSlice} />
        </div>
      )}

      {/* Actions */}
      {!entry.undone && (
        <button
          onClick={() => undoEntry(entry.id)}
          className="mt-2 text-xs text-muted hover:text-accent transition-colors"
        >
          Undo this change
        </button>
      )}
    </div>
  )
}

function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}
