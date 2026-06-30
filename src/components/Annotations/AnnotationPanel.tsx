'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useDocumentStore } from '@/stores/documentStore'
import { AnnotationCard } from './AnnotationCard'
import { AnnotationMap } from './AnnotationMap'
import type { Annotation } from '@/lib/annotations/types'

type ViewMode = 'list' | 'map'

function sortThreads(annotations: Annotation[]): Annotation[] {
  return [...annotations].sort((a, b) => {
    const aPending = a.status !== 'applied' && a.status !== 'dismissed'
    const bPending = b.status !== 'applied' && b.status !== 'dismissed'
    if (aPending !== bPending) return aPending ? -1 : 1
    const aUpdated = a.resolvedAt ?? a.createdAt
    const bUpdated = b.resolvedAt ?? b.createdAt
    return bUpdated - aUpdated
  })
}

function collectChildren(parentId: string, byParent: Map<string, Annotation[]>): Annotation[] {
  const children = sortThreads(byParent.get(parentId) ?? [])
  return children.flatMap((child) => [child, ...collectChildren(child.id, byParent)])
}

export function AnnotationPanel() {
  const annotations = useAnnotationStore((s) => s.annotations)
  const activeId = useAnnotationStore((s) => s.activeAnnotationId)
  const activeDocumentId = useDocumentStore((s) => s.activeDocumentId)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const listRef = useRef<HTMLDivElement>(null)

  // Listen for scroll-to-annotation events (from drill/spin-off creation)
  useEffect(() => {
    function handleScrollTo(e: Event) {
      const annotationId = (e as CustomEvent).detail
      if (!annotationId || !listRef.current) return
      // Small delay to allow React to render the new card
      requestAnimationFrame(() => {
        const card = listRef.current?.querySelector(`[data-annotation-id="${annotationId}"]`)
        card?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    }
    window.addEventListener('intent-ide:scroll-to-annotation', handleScrollTo)
    return () => window.removeEventListener('intent-ide:scroll-to-annotation', handleScrollTo)
  }, [])

  const groupedAnnotations = useMemo(() => {
    if (!activeDocumentId) return []

    const documentAnnotations = annotations.filter((annotation) => annotation.documentId === activeDocumentId)
    const groups = new Map<string, Annotation[]>()

    documentAnnotations.forEach((annotation) => {
      const current = groups.get(annotation.locationGroupKey) ?? []
      current.push(annotation)
      groups.set(annotation.locationGroupKey, current)
    })

    return [...groups.values()]
      .map((group) => {
        const byParent = new Map<string, Annotation[]>()
        group.forEach((annotation) => {
          if (!annotation.parentId) return
          const current = byParent.get(annotation.parentId) ?? []
          current.push(annotation)
          byParent.set(annotation.parentId, current)
        })

        const roots = sortThreads(group.filter((annotation) => !annotation.parentId || !group.some((item) => item.id === annotation.parentId)))
        const flattened = roots.flatMap((root) => [root, ...collectChildren(root.id, byParent)])
        const anchor = group.reduce((lowest, annotation) => Math.min(lowest, annotation.anchor.from), Number.POSITIVE_INFINITY)

        return {
          key: group[0].locationGroupKey,
          anchor,
          anchorText: group[0].anchor.text,
          annotations: flattened,
        }
      })
      .sort((a, b) => a.anchor - b.anchor)
  }, [activeDocumentId, annotations])

  const annotationCount = groupedAnnotations.reduce((sum, group) => sum + group.annotations.length, 0)

  if (!activeDocumentId || annotationCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center px-6">
        <div className="w-12 h-12 rounded-full bg-warm flex items-center justify-center mb-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
          </svg>
        </div>
        <p className="text-sm text-muted-foreground">No annotations for this document</p>
        <p className="text-xs text-muted-foreground/60 mt-1">Highlight text and annotate in place</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/70 bg-white/45">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.2em]">
          {annotationCount} review item{annotationCount !== 1 ? 's' : ''}
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => setViewMode('list')}
            title="Grouped list view"
            className={`p-1.5 rounded-lg transition-colors ${viewMode === 'list' ? 'bg-ink text-white shadow-sm' : 'text-muted-foreground hover:bg-warm/80'}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          </button>
          <button
            onClick={() => setViewMode('map')}
            title="Map view (beta)"
            className={`p-1.5 rounded-lg transition-colors ${viewMode === 'map' ? 'bg-ink text-white shadow-sm' : 'text-muted-foreground hover:bg-warm/80'}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="12" y1="3" x2="12" y2="21" />
            </svg>
          </button>
        </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto">
        {viewMode === 'list' ? (
          <div className="space-y-3 p-4">
            {groupedAnnotations.map((group) => (
              <section key={group.key} className="rounded-[22px] border border-border/70 bg-white/78 overflow-hidden shadow-sm">
                <div className="px-4 py-3 border-b border-border/70 bg-gradient-to-r from-warm/50 to-white/70">
                  <div className="flex items-center justify-between gap-3">
                    <span className="status-chip px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-[0.18em]">
                      Position {group.anchor}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.18em]">
                      {group.annotations.length} thread{group.annotations.length !== 1 ? ' items' : ''}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
                    {group.anchorText}
                  </p>
                </div>
                <div className="divide-y divide-border/70">
                  {group.annotations.map((annotation) => (
                    <div key={annotation.id} className={annotation.parentId ? 'ml-4 border-l border-border/60 bg-warm/10' : ''}>
                      <AnnotationCard
                        annotation={annotation}
                        isActive={annotation.id === activeId}
                      />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div>
            <div className="px-4 py-3 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground border-b border-border/70 bg-white/45">
              Map (beta)
            </div>
            <AnnotationMap />
          </div>
        )}
      </div>
    </div>
  )
}
