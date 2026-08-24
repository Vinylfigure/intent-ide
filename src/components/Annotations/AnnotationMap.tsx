'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useDocumentStore } from '@/stores/documentStore'
import { useEditorStore } from '@/stores/editorStore'
import { markUserActivated } from '@/lib/voice/pipeline'
import { clusterMarkers } from '@/lib/annotations/clusterMarkers'
import { ANNOTATION_COLORS } from '@/lib/annotations/types'

export function AnnotationMap() {
  const annotations = useAnnotationStore((s) => s.annotations)
  const activeId = useAnnotationStore((s) => s.activeAnnotationId)
  const setActive = useAnnotationStore((s) => s.setActive)
  const view = useEditorStore((s) => s.view)
  const activeDocumentId = useDocumentStore((s) => s.activeDocumentId)
  const [openClusterIndex, setOpenClusterIndex] = useState<number | null>(null)
  const visibleAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.documentId === activeDocumentId),
    [activeDocumentId, annotations]
  )

  const docLength = view?.state.doc.content.size ?? 1

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

  // A stale index after the cluster list reshapes would open the wrong popover.
  useEffect(() => {
    setOpenClusterIndex(null)
  }, [clusters.length, activeDocumentId])

  const handleSelect = (id: string) => {
    // Map-marker selection is user attention — clear the capture mark.
    markUserActivated(id)
    setActive(id)
    setOpenClusterIndex(null)
    if (view) {
      const ann = visibleAnnotations.find((a) => a.id === id)
      if (ann) {
        const coords = view.coordsAtPos(ann.anchor.from)
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
      }
    }
  }

  if (visibleAnnotations.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
        No annotations to map
      </div>
    )
  }

  return (
    <div className="relative h-full min-h-[200px] px-3 py-2">
      {/* Vertical track */}
      <div className="absolute left-1/2 top-2 bottom-2 w-px bg-border -translate-x-1/2" />

      {/* Markers — one dot per cluster */}
      {clusters.map((cluster, index) => {
        const top = `${Math.max(2, Math.min(98, cluster.position * 100))}%`
        const hasActive = cluster.members.some((m) => m.isActive)

        if (cluster.members.length === 1) {
          const m = cluster.members[0]
          return (
            <button
              key={m.id}
              onClick={() => handleSelect(m.id)}
              title={m.label}
              className={`absolute left-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-white shadow-sm transition-transform hover:scale-150 ${
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
          <div key={cluster.members[0].id} className="absolute left-1/2 -translate-x-1/2" style={{ top }}>
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
