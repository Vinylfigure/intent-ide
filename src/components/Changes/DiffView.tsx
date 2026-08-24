'use client'

import { useMemo } from 'react'
import { computeWordDiff, type DiffChunk } from '@/lib/changes/diffEngine'

interface DiffViewProps {
  before: string
  after: string
}

/**
 * Word-level diff of a change slice. Unchanged runs render as plain text;
 * only changed words carry the add/remove treatment, so a one-word edit
 * reads as one marked word instead of a full repaint of both slices.
 *
 * No line-number gutter: the slices are document fragments, so any numbers
 * here would be slice-relative and imply document positions they don't have.
 */
export function DiffView({ before, after }: DiffViewProps) {
  const chunks = useMemo(() => computeWordDiff(before, after), [before, after])

  return (
    <div className="rounded-xl border border-border/70 overflow-hidden bg-white">
      {before && (
        <DiffSide
          chunks={chunks}
          side="before"
          className={`bg-red-50/60 ${after ? 'border-b border-border/50' : ''}`}
        />
      )}
      {after && <DiffSide chunks={chunks} side="after" className="bg-emerald-50/60" />}
    </div>
  )
}

function DiffSide({ chunks, side, className }: {
  chunks: DiffChunk[]
  side: 'before' | 'after'
  className: string
}) {
  const marker = side === 'before' ? '-' : '+'
  const markerClass = side === 'before' ? 'text-red-500/70' : 'text-emerald-600/70'
  const visible = chunks.filter((c) => c.type !== (side === 'before' ? 'insert' : 'delete'))

  return (
    <div className={`flex gap-2 px-2.5 py-1.5 font-mono text-xs ${className}`}>
      <span aria-hidden="true" className={`select-none shrink-0 ${markerClass}`}>
        {marker}
      </span>
      <p className="min-w-0 whitespace-pre-wrap break-words text-ink/80">
        {visible.map((chunk, index) =>
          chunk.type === 'equal' ? (
            <span key={index}>{chunk.text}</span>
          ) : chunk.type === 'delete' ? (
            <del key={index} className="rounded-sm bg-red-200/80 px-0.5 text-red-900 no-underline">
              {chunk.text}
            </del>
          ) : (
            <ins key={index} className="rounded-sm bg-emerald-200/80 px-0.5 text-emerald-900 no-underline">
              {chunk.text}
            </ins>
          )
        )}
      </p>
    </div>
  )
}
