'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useLayoutStore } from '@/stores/layoutStore'
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

/**
 * Which annotation ids should render given the show-resolved toggle. An
 * annotation is visible when it isn't hidden (or the toggle is on), OR when
 * at least one descendant is still visible — hiding a thread root must
 * never orphan a still-visible child from the UI. `undefined`/`false`
 * `hidden` both count as "not hidden" (the upgrade case: a snapshot from
 * before this field existed has it undefined everywhere and must render in
 * full). Builds its own parent→child index from `parentId` rather than
 * requiring a caller-supplied one, so it's testable on a flat annotation
 * list in isolation.
 */
export function computeVisibleAnnotationIds(annotations: Annotation[], showResolved: boolean): Set<string> {
  const byParent = new Map<string, Annotation[]>()
  for (const a of annotations) {
    if (!a.parentId) continue
    const current = byParent.get(a.parentId) ?? []
    current.push(a)
    byParent.set(a.parentId, current)
  }

  const visible = new Set<string>()
  const memo = new Map<string, boolean>()

  function visit(a: Annotation, stack: Set<string>): boolean {
    const cached = memo.get(a.id)
    if (cached !== undefined) return cached
    if (stack.has(a.id)) return false // parentId cycle guard — see computeDepth above
    stack.add(a.id)
    const children = byParent.get(a.id) ?? []
    const anyChildVisible = children.some((child) => visit(child, stack))
    stack.delete(a.id)
    const selfVisible = showResolved || a.hidden !== true || anyChildVisible
    memo.set(a.id, selfVisible)
    if (selfVisible) visible.add(a.id)
    return selfVisible
  }

  for (const a of annotations) visit(a, new Set())
  return visible
}

/**
 * Depth of `id` within its group's parentId chain, walked iteratively (not
 * recursively) so a parentId cycle, or a parentId pointing outside the
 * group, just stops the walk instead of looping forever — both cases fall
 * back to however many real ancestors were found before the walk stopped
 * (0 for an immediate cycle or a missing/absent parent).
 */
function computeDepth(id: string, byId: Map<string, Annotation>): number {
  let depth = 0
  let current = byId.get(id)
  const seen = new Set<string>([id])
  while (current?.parentId && byId.has(current.parentId) && !seen.has(current.parentId)) {
    seen.add(current.parentId)
    depth += 1
    current = byId.get(current.parentId)
  }
  return depth
}

export function AnnotationPanel() {
  const annotations = useAnnotationStore((s) => s.annotations)
  const activeId = useAnnotationStore((s) => s.activeAnnotationId)
  const activeDocumentId = useDocumentStore((s) => s.activeDocumentId)
  const placement = useLayoutStore((s) => s.answerPlacement)
  const setPlacement = useLayoutStore((s) => s.setAnswerPlacement)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  // "Show N resolved" toggle: local view state (not persisted, not
  // annotation state) — reveals hidden annotations and hides them again.
  const [showResolved, setShowResolved] = useState(false)
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

  const documentAnnotations = useMemo(
    () => (activeDocumentId ? annotations.filter((annotation) => annotation.documentId === activeDocumentId) : []),
    [activeDocumentId, annotations]
  )

  // Hidden annotations (Annotation.hidden === true) are excluded from both
  // the rendered list and the header count below, unless showResolved is
  // on — but never a parent whose child is still visible (computeVisibleAnnotationIds
  // guards that).
  const hiddenCount = useMemo(
    () => documentAnnotations.filter((annotation) => annotation.hidden === true).length,
    [documentAnnotations]
  )

  const groupedAnnotations = useMemo(() => {
    if (documentAnnotations.length === 0) return []

    const visibleIds = computeVisibleAnnotationIds(documentAnnotations, showResolved)
    const groups = new Map<string, Annotation[]>()

    documentAnnotations.forEach((annotation) => {
      const current = groups.get(annotation.locationGroupKey) ?? []
      current.push(annotation)
      groups.set(annotation.locationGroupKey, current)
    })

    return [...groups.values()]
      .map((group) => {
        const byId = new Map(group.map((annotation) => [annotation.id, annotation]))
        const byParent = new Map<string, Annotation[]>()
        group.forEach((annotation) => {
          if (!annotation.parentId) return
          const current = byParent.get(annotation.parentId) ?? []
          current.push(annotation)
          byParent.set(annotation.parentId, current)
        })

        // Tree built from the FULL group (hidden annotations included) so a
        // hidden parent still correctly threads its still-visible children;
        // the hidden/resolved filter is applied afterward, to the flattened
        // result, never to the tree-building inputs.
        const roots = sortThreads(group.filter((annotation) => !annotation.parentId || !group.some((item) => item.id === annotation.parentId)))
        const flattened = roots
          .flatMap((root) => [root, ...collectChildren(root.id, byParent)])
          .filter((annotation) => visibleIds.has(annotation.id))
        const anchor = group.reduce((lowest, annotation) => Math.min(lowest, annotation.anchor.from), Number.POSITIVE_INFINITY)
        const depths = new Map(group.map((annotation) => [annotation.id, computeDepth(annotation.id, byId)]))

        return {
          key: group[0].locationGroupKey,
          anchor,
          anchorText: group[0].anchor.text,
          annotations: flattened,
          depths,
        }
      })
      .filter((group) => group.annotations.length > 0)
      .sort((a, b) => a.anchor - b.anchor)
  }, [documentAnnotations, showResolved])

  const annotationCount = groupedAnnotations.reduce((sum, group) => sum + group.annotations.length, 0)

  if (!activeDocumentId || documentAnnotations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center px-6">
        <div className="w-12 h-12 rounded-full bg-warm flex items-center justify-center mb-3">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
          </svg>
        </div>
        <p className="text-sm text-muted-foreground">No annotations for this document</p>
        <p className="text-xs text-muted-foreground mt-1">Highlight text and annotate in place</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/70 bg-white/45">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.2em]">
          {annotationCount} review item{annotationCount !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-2">
          <div className="placement-toggle" role="group" aria-label="Where answers appear">
            <button
              onClick={() => setPlacement('sidebar')}
              aria-pressed={placement === 'sidebar'}
              title="Answers expand here in the sidebar"
              className="placement-toggle-btn"
            >
              Sidebar
            </button>
            <button
              onClick={() => setPlacement('floating')}
              aria-pressed={placement === 'floating'}
              title="Answers float beside the passage they belong to"
              className="placement-toggle-btn"
            >
              Floating
            </button>
          </div>
          {hiddenCount > 0 && (
            <button
              onClick={() => setShowResolved((v) => !v)}
              aria-pressed={showResolved}
              aria-label={
                showResolved
                  ? 'Hide resolved threads'
                  : `Show ${hiddenCount} resolved thread${hiddenCount !== 1 ? 's' : ''}`
              }
              title={showResolved ? 'Hide finished threads again' : 'Show finished threads that were hidden'}
              className={`px-2 py-1 rounded-lg text-[10px] font-mono uppercase tracking-[0.15em] transition-colors ${
                showResolved ? 'bg-ink text-white shadow-sm' : 'text-muted-foreground hover:bg-warm/80'
              }`}
            >
              {showResolved ? 'Hide resolved' : `Show ${hiddenCount} resolved`}
            </button>
          )}
          <button
            onClick={() => setViewMode('list')}
            aria-label="Grouped list view"
            aria-pressed={viewMode === 'list'}
            title="Grouped list view"
            className={`p-1.5 rounded-lg transition-colors ${viewMode === 'list' ? 'bg-ink text-white shadow-sm' : 'text-muted-foreground hover:bg-warm/80'}`}
          >
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          </button>
          <button
            onClick={() => setViewMode('map')}
            aria-label="Map view (beta)"
            aria-pressed={viewMode === 'map'}
            title="Map view (beta)"
            className={`p-1.5 rounded-lg transition-colors ${viewMode === 'map' ? 'bg-ink text-white shadow-sm' : 'text-muted-foreground hover:bg-warm/80'}`}
          >
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="12" y1="3" x2="12" y2="21" />
            </svg>
          </button>
        </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto">
        {viewMode === 'list' ? (
          groupedAnnotations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center px-6">
              <p className="text-sm text-muted-foreground">All caught up</p>
              <p className="text-xs text-muted-foreground mt-1">
                {hiddenCount} finished thread{hiddenCount !== 1 ? 's' : ''} hidden — use the toggle above to review {hiddenCount === 1 ? 'it' : 'them'}.
              </p>
            </div>
          ) : (
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
                  {group.annotations.map((annotation) => {
                    const depth = group.depths.get(annotation.id) ?? 0
                    // Cap the visual indent — a level-9 sub-chat still reads
                    // as "deeply nested," it just doesn't shove the card off
                    // the edge of a narrow rail.
                    const indent = Math.min(depth, 5)
                    return (
                      <div
                        key={annotation.id}
                        className={depth > 0 ? 'border-l border-border/60 bg-warm/10' : ''}
                        style={depth > 0 ? { marginLeft: `${indent}rem` } : undefined}
                      >
                        {annotation.sourceQuote && (
                          <p className="px-2.5 pt-1.5 text-[10px] font-mono text-muted-foreground truncate">
                            “{annotation.sourceQuote}”
                          </p>
                        )}
                        <AnnotationCard
                          annotation={annotation}
                          isActive={annotation.id === activeId}
                          detailElsewhere={placement === 'floating'}
                        />
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
          )
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
