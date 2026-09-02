'use client'

import { useSettingsStore } from '@/stores/settingsStore'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useChangesStore } from '@/stores/changesStore'
import { useDocGraphStore, type DocGraphStatus } from '@/stores/docGraphStore'
import { useDocumentStore } from '@/stores/documentStore'
import { providerCapabilities } from '@/lib/ai/modelCapabilities'

/** Chip state for annotations still being classified/resolved in the background. */
function inFlightChip(count: number): { label: string; title: string } | null {
  if (count === 0) return null
  return {
    label: `${count} thinking…`,
    title: `${count} annotation${count > 1 ? 's are' : ' is'} being classified and resolved in the background.`,
  }
}

/**
 * Chip state for the document-map (doc graph) build lifecycle. Exported for
 * test. `reasonNoEmbeddings`, when given, is folded into the "rules only"
 * tooltip so a reader can tell WHY meaning-based connections are absent
 * (provider has no embeddings API vs. turned off in settings) rather than
 * just that they are.
 */
export function graphChip(
  status: DocGraphStatus,
  graph: {
    llmApplied: boolean
    llmPartial: boolean
    embeddingsPartial: boolean
    /** Optional so pre-existing `ready` graph literals (built before this field existed) still typecheck. */
    embeddingsApplied?: boolean
  } | null,
  reasonNoEmbeddings?: string,
): { label: string; title: string } | null {
  if (status === 'enriching') {
    return {
      label: 'graph: linking meaning…',
      title:
        'Finding meaning-based connections between passages in the background — the section map is already usable while this runs.',
    }
  }
  if (status === 'building') {
    return {
      label: 'graph: building…',
      title: 'Mapping how sections of your document relate to each other.',
    }
  }
  // No graph is a REAL state, not an absent one: until it builds, related
  // passages, blast-radius previews and edge-path explanations all quietly
  // return nothing. Rendering no chip made that indistinguishable from
  // "everything is fine", which is how it went unnoticed.
  if (!graph) {
    return {
      label: 'graph: not built',
      title:
        'The section map has not been built for this document yet, so connections between sections are unavailable. It builds automatically when the document loads or changes.',
    }
  }
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
  if (graph.embeddingsApplied) {
    return {
      label: `graph: rules + meaning${partial ? ' +partial' : ''}`,
      title: `The section map includes meaning-based connections found while reading, plus explicit cross-references and repeated terms.${partialNote}`,
    }
  }
  return {
    label: `graph: rules only${partial ? ' +partial' : ''}`,
    title: `The section map only covers explicit cross-references and repeated terms so far.${
      reasonNoEmbeddings ? ` ${reasonNoEmbeddings}` : ''
    } AI-detected connections are added when an annotation is resolved.${partialNote}`,
  }
}

/** Why the graph has no meaning-based (embedding) edges yet — surfaced in the "rules only" tooltip. */
function reasonNoEmbeddings(
  provider: string,
  baseUrl: string | undefined,
  embeddingsEnabled: boolean,
  graphEnrichment: 'off' | 'local-only' | 'always',
): string | undefined {
  if (!providerCapabilities(provider, baseUrl).embeddings) {
    return provider === 'openrouter'
      ? 'OpenRouter has no embeddings API.'
      : provider === 'claude'
        ? 'Claude has no embeddings API.'
        : 'This provider has no embeddings API.'
  }
  if (!embeddingsEnabled) return 'Semantic similarity edges are turned off in settings.'
  if (graphEnrichment === 'off') return 'Linking meaning while reading is turned off in settings.'
  if (graphEnrichment === 'local-only' && provider !== 'ollama') {
    return 'Linking meaning while reading is set to local-only, and this provider is not Ollama.'
  }
  return undefined
}

export function StatusBar() {
  const provider = useSettingsStore((s) => s.llmConfig.provider)
  const model = useSettingsStore((s) => s.llmConfig.model)
  const baseUrl = useSettingsStore((s) => s.llmConfig.baseUrl)
  const embeddingsEnabled = useSettingsStore((s) => s.embeddingsEnabled)
  const graphEnrichment = useSettingsStore((s) => s.graphEnrichment)
  const hasKeys = useSettingsStore((s) => s.hasKeys())
  const activeDocumentId = useDocumentStore((s) => s.activeDocumentId)
  const annotationCount = useAnnotationStore(
    (s) => s.annotations.filter((a) => a.documentId === activeDocumentId).length,
  )
  const inFlightCount = useAnnotationStore(
    (s) =>
      s.annotations.filter(
        (a) =>
          a.documentId === activeDocumentId &&
          (a.status === 'pending' || a.status === 'classified' || a.status === 'resolving'),
      ).length,
  )
  const changeSetCount = useChangesStore(
    (s) => s.changeSets.filter((cs) => cs.documentId === activeDocumentId).length,
  )
  const changeCount = useChangesStore(
    (s) => s.entries.filter((e) => !e.undone && e.documentId === activeDocumentId).length,
  )
  const graphStatus = useDocGraphStore((s) => s.status)
  const graph = useDocGraphStore((s) => s.graph)
  const chip = graphChip(
    graphStatus,
    graph,
    reasonNoEmbeddings(provider, baseUrl, embeddingsEnabled, graphEnrichment),
  )
  const thinkingChip = inFlightChip(inFlightCount)

  return (
    <div className="flex items-center justify-between px-4 py-2 border-t border-border/70 bg-white/70 backdrop-blur-sm text-xs font-mono text-muted-foreground">
      <div className="flex items-center gap-4">
        <span className="status-chip px-2.5 py-1 rounded-full">{annotationCount} annotations</span>
        <span className="status-chip px-2.5 py-1 rounded-full">{changeSetCount} change sets</span>
        <span className="status-chip px-2.5 py-1 rounded-full">{changeCount} changes</span>
        {chip && (
          <span className="status-chip px-2.5 py-1 rounded-full" title={chip.title}>
            {chip.label}
          </span>
        )}
        {thinkingChip && (
          <span className="status-chip px-2.5 py-1 rounded-full" title={thinkingChip.title}>
            {thinkingChip.label}
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        <span className={`status-chip px-2.5 py-1 rounded-full ${hasKeys ? 'text-ink' : 'text-accent'}`}>
          {hasKeys ? `${provider} · ${model}` : 'No API key set'}
        </span>
        <span className="status-chip px-2.5 py-1 rounded-full">Voice: Ctrl+Space</span>
      </div>
    </div>
  )
}
