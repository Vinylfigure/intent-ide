'use client'

import { useMemo } from 'react'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useDocumentStore } from '@/stores/documentStore'
import { useEditorStore } from '@/stores/editorStore'
import { ANNOTATION_COLORS } from '@/lib/annotations/types'

export function AnnotationMap() {
  const annotations = useAnnotationStore((s) => s.annotations)
  const activeId = useAnnotationStore((s) => s.activeAnnotationId)
  const setActive = useAnnotationStore((s) => s.setActive)
  const view = useEditorStore((s) => s.view)
  const activeDocumentId = useDocumentStore((s) => s.activeDocumentId)
  const visibleAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.documentId === activeDocumentId),
    [activeDocumentId, annotations]
  )

  const docLength = view?.state.doc.content.size ?? 1

  // Group annotations by rough position (within 5% of doc length)
  const markers = useMemo(() => {
    return visibleAnnotations.map((a) => ({
      id: a.id,
      type: a.type,
      position: a.anchor.from / docLength,
      label: a.transcript.slice(0, 30),
      isActive: a.id === activeId,
    }))
  }, [visibleAnnotations, docLength, activeId])

  const handleClick = (id: string) => {
    setActive(id)
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

      {/* Markers */}
      {markers.map((m) => (
        <button
          key={m.id}
          onClick={() => handleClick(m.id)}
          title={m.label}
          className={`absolute left-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-white shadow-sm transition-transform hover:scale-150 ${
            m.isActive ? 'scale-150 ring-2 ring-offset-1' : ''
          }`}
          style={{
            top: `${Math.max(2, Math.min(98, m.position * 100))}%`,
            backgroundColor: ANNOTATION_COLORS[m.type],
            '--tw-ring-color': m.isActive ? ANNOTATION_COLORS[m.type] : undefined,
          } as React.CSSProperties}
        />
      ))}

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
