'use client'

import { useSettingsStore } from '@/stores/settingsStore'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useChangesStore } from '@/stores/changesStore'
import { useDocGraphStore } from '@/stores/docGraphStore'

/** Chip state for the document-map (doc graph) build lifecycle. */
function graphChip(
  status: 'idle' | 'building' | 'ready',
  graph: { llmApplied: boolean; llmPartial: boolean; embeddingsPartial: boolean } | null,
): { label: string; title: string } | null {
  if (status === 'building') {
    return {
      label: 'graph: building…',
      title: 'Mapping how sections of your document relate to each other.',
    }
  }
  if (!graph) return null
  const partial = graph.llmPartial || graph.embeddingsPartial
  const partialNote = partial
    ? ' Some sections could not be analyzed, so a few connections may be missing.'
    : ''
  if (graph.llmApplied) {
    return {
      label: `graph: enriched${partial ? ' +partial' : ''}`,
      title: `The section map includes AI-detected connections between sections.${partialNote}`,
    }
  }
  return {
    label: `graph: rules only${partial ? ' +partial' : ''}`,
    title: `The section map only covers explicit cross-references and repeated terms so far. AI-detected connections are added when an annotation is resolved.${partialNote}`,
  }
}

export function StatusBar() {
  const provider = useSettingsStore((s) => s.llmConfig.provider)
  const model = useSettingsStore((s) => s.llmConfig.model)
  const hasKeys = useSettingsStore((s) => s.llmConfig.apiKey.length > 0)
  const annotationCount = useAnnotationStore((s) => s.annotations.length)
  const changeSetCount = useChangesStore((s) => s.changeSets.length)
  const changeCount = useChangesStore((s) => s.entries.filter((e) => !e.undone).length)
  const graphStatus = useDocGraphStore((s) => s.status)
  const graph = useDocGraphStore((s) => s.graph)
  const chip = graphChip(graphStatus, graph)

  return (
    <div className="flex items-center justify-between px-4 py-2 border-t border-border/70 bg-white/70 backdrop-blur-sm text-xs font-mono text-muted">
      <div className="flex items-center gap-4">
        <span className="status-chip px-2.5 py-1 rounded-full">{annotationCount} annotations</span>
        <span className="status-chip px-2.5 py-1 rounded-full">{changeSetCount} change sets</span>
        <span className="status-chip px-2.5 py-1 rounded-full">{changeCount} changes</span>
        {chip && (
          <span className="status-chip px-2.5 py-1 rounded-full" title={chip.title}>
            {chip.label}
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        <span className={`status-chip px-2.5 py-1 rounded-full ${hasKeys ? 'text-annotation-correction' : 'text-accent'}`}>
          {hasKeys ? `${provider} · ${model}` : 'No API key set'}
        </span>
        <span className="status-chip px-2.5 py-1 rounded-full">Voice: Ctrl+Space</span>
      </div>
    </div>
  )
}
