'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Node as PMNode } from 'prosemirror-model'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useDocumentStore } from '@/stores/documentStore'
import { useEditorStore } from '@/stores/editorStore'
import { markUserActivated } from '@/lib/voice/pipeline'
import { clusterMarkers } from '@/lib/annotations/clusterMarkers'
import { collectHeadings, visibleHeadingLabels } from '@/lib/annotations/documentOutline'
import { readLinePluginKey } from '@/lib/prosemirror/plugins/readLinePlugin'
import { ANNOTATION_COLORS } from '@/lib/annotations/types'

const HEADING_LABEL_CLASS: Record<number, string> = {
  1: 'font-semibold text-ink',
  2: 'text-ink/80',
}

/**
 * The document map: headings form the spine, annotation clusters sit on it as
 * markers, and the read-line shows how far the reader has gotten — document
 * structure and review state in one proportional view.
 */
export function AnnotationMap() {
  const annotations = useAnnotationStore((s) => s.annotations)
  const activeId = useAnnotationStore((s) => s.activeAnnotationId)
  const setActive = useAnnotationStore((s) => s.setActive)
  const view = useEditorStore((s) => s.view)
  const activeDocumentId = useDocumentStore((s) => s.activeDocumentId)
  const [openClusterIndex, setOpenClusterIndex] = useState<number | null>(null)

  // ProseMirror edits and read-line advances don't flow through a React store,
  // so poll a snapshot; the identity bail-out below makes quiet ticks free.
  const [snapshot, setSnapshot] = useState<{ doc: PMNode | null; readPos: number }>({
    doc: null,
    readPos: 0,
  })
  useEffect(() => {
    if (!view) return
    const read = () => {
      if (view.isDestroyed) return
      const doc = view.state.doc
      const readPos = readLinePluginKey.getState(view.state)?.highWaterMark ?? 0
      setSnapshot((prev) => (prev.doc === doc && prev.readPos === readPos ? prev : { doc, readPos }))
    }
    read()
    const timer = setInterval(read, 1500)
    return () => clearInterval(timer)
  }, [view])

  const visibleAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.documentId === activeDocumentId),
    [activeDocumentId, annotations]
  )

  const docLength = snapshot.doc?.content.size || 1

  const markers = useMemo(() => {
    return visibleAnnotations.map((a) => ({
      id: a.id,
      type: a.type,
      position: a.anchor.from / docLength,
      label: a.transcript.slice(0, 30),
      isActive: a.id === activeId,
    }))
  }, [visibleAnnotations, docLength, activeId])

  // Markers within 5% of doc length of each other collapse into one cluster
  // with a count badge, so co-located annotations stay reachable instead of
  // rendering at pixel-identical positions where only the topmost is clickable.
  const clusters = useMemo(() => clusterMarkers(markers), [markers])

  const headings = useMemo(() => (snapshot.doc ? collectHeadings(snapshot.doc) : []), [snapshot.doc])
  const headingLabels = useMemo(() => visibleHeadingLabels(headings), [headings])
  const readFraction = snapshot.readPos > 0 ? snapshot.readPos / docLength : 0

  // A stale index after the cluster list reshapes would open the wrong popover.
  useEffect(() => {
    setOpenClusterIndex(null)
  }, [clusters.length, activeDocumentId])

  const scrollToPos = (pos: number) => {
    if (!view) return
    const coords = view.coordsAtPos(Math.min(pos, view.state.doc.content.size))
    if (!coords) return
    const container = view.dom.closest('.editor-scroll-container')
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    container.scrollTo({
      top: container.scrollTop + (coords.top - containerRect.top) - 100,
      behavior: 'smooth',
    })
  }

  const handleSelect = (id: string) => {
    // Map-marker selection is user attention — clear the capture mark.
    markUserActivated(id)
    setActive(id)
    setOpenClusterIndex(null)
    const ann = visibleAnnotations.find((a) => a.id === id)
    if (ann) scrollToPos(ann.anchor.from)
  }

  if (!snapshot.doc) {
    return (
      <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
        No document open
      </div>
    )
  }

  if (visibleAnnotations.length === 0 && headings.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 px-6 text-center text-xs text-muted-foreground">
        Nothing to map yet — headings and annotations will appear here
      </div>
    )
  }

  const clamp = (fraction: number) => Math.max(2, Math.min(98, fraction * 100))

  return (
    <div className="relative h-full min-h-[260px] px-3 py-2">
      {/* Vertical track — the document, top to bottom */}
      <div className="absolute left-1/2 top-2 bottom-2 w-px bg-border -translate-x-1/2" />

      {/* Read-line: how far the reader has gotten */}
      {readFraction > 0 && (
        <div
          className="absolute inset-x-2 z-0"
          style={{ top: `${clamp(readFraction)}%` }}
          title="Read up to here"
        >
          <div className="border-t border-dashed border-accent/70" />
          <span className="absolute right-0 -top-2 text-[8px] font-mono uppercase tracking-widest text-accent/80">
            read
          </span>
        </div>
      )}

      {/* Headings — the spine, labels to the left of the track */}
      {headings.map((heading, index) => (
        <button
          key={`${heading.pos}-${index}`}
          onClick={() => scrollToPos(heading.pos)}
          title={heading.text || '(untitled heading)'}
          className="group absolute right-1/2 z-10 flex -translate-y-1/2 items-center gap-1.5 pr-0"
          style={{ top: `${clamp(heading.position)}%` }}
        >
          {headingLabels[index] && (
            <span
              className={`max-w-[9rem] truncate text-right text-[10px] leading-tight transition-colors group-hover:text-accent ${
                HEADING_LABEL_CLASS[heading.level] ?? 'text-muted-foreground'
              }`}
            >
              {heading.text || '(untitled)'}
            </span>
          )}
          <span className="h-px w-2.5 shrink-0 bg-border group-hover:bg-accent" />
        </button>
      ))}

      {/* Annotation markers — one dot per cluster, on the track */}
      {clusters.map((cluster, index) => {
        const top = `${clamp(cluster.position)}%`
        const hasActive = cluster.members.some((m) => m.isActive)

        if (cluster.members.length === 1) {
          const m = cluster.members[0]
          return (
            <button
              key={m.id}
              onClick={() => handleSelect(m.id)}
              title={m.label}
              className={`absolute left-1/2 z-10 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-white shadow-sm transition-transform hover:scale-150 ${
                m.isActive ? 'scale-150 ring-2 ring-offset-1' : ''
              }`}
              style={{
                top,
                backgroundColor: ANNOTATION_COLORS[m.type],
                '--tw-ring-color': m.isActive ? ANNOTATION_COLORS[m.type] : undefined,
              } as React.CSSProperties}
            />
          )
        }

        const isOpen = openClusterIndex === index
        return (
          <div key={cluster.members[0].id} className="absolute left-1/2 z-10 -translate-x-1/2" style={{ top }}>
            <button
              onClick={() => setOpenClusterIndex(isOpen ? null : index)}
              aria-expanded={isOpen}
              title={`${cluster.members.length} annotations here`}
              className={`flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-ink text-[10px] font-mono font-semibold text-white shadow-sm transition-transform hover:scale-125 ${
                hasActive || isOpen ? 'scale-125 ring-2 ring-offset-1 ring-ink/40' : ''
              }`}
            >
              {cluster.members.length}
            </button>
            {isOpen && (
              <div className="absolute left-6 top-0 z-20 w-44 rounded-xl border border-border/70 bg-white py-1 shadow-lg">
                {cluster.members.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => handleSelect(m.id)}
                    className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-warm ${
                      m.isActive ? 'font-semibold' : ''
                    }`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: ANNOTATION_COLORS[m.type] }}
                    />
                    <span className="min-w-0 truncate">{m.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* Legend */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-center gap-3 py-2 bg-white/80">
        {(['ask', 'edit', 'dig', 'flag'] as const).map((type) => {
          const count = visibleAnnotations.filter((a) => a.type === type).length
          if (count === 0) return null
          return (
            <div key={type} className="flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: ANNOTATION_COLORS[type] }}
              />
              <span className="text-[10px] font-mono text-muted-foreground">
                {count}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
