/**
 * Episode Ingestion Service — feeds resolved annotations into GraphRAG.
 *
 * When an annotation is resolved or an edit is applied, the annotation context
 * (transcript, resolution, anchor text) is ingested as a Graphiti Episode so
 * the knowledge graph stays in sync with the document's semantic state.
 */

import { addEpisode, type Episode } from '@/lib/mcp/graphitiClient'
import type { Annotation } from '@/lib/annotations/types'

/**
 * Ingest a resolved annotation as a Graphiti Episode.
 * Silently no-ops if the MCP server is unreachable (non-blocking).
 */
export async function ingestAnnotationEpisode(annotation: Annotation): Promise<boolean> {
  if (!annotation.resolution) return false

  const episodeBody = buildEpisodeBody(annotation)

  const episode: Episode = {
    name: `annotation-${annotation.type}-${annotation.id.slice(0, 8)}`,
    content: episodeBody,
    sourceDescription: `intent-ide-${annotation.type}`,
    referenceTime: new Date().toISOString(),
  }

  try {
    await addEpisode(episode)
    return true
  } catch {
    // MCP server may not be running — this is non-blocking
    return false
  }
}

/**
 * Ingest a document edit as a Graphiti Episode.
 * Captures before/after text for the knowledge graph to track changes.
 */
export async function ingestEditEpisode(
  annotationId: string,
  beforeText: string,
  afterText: string,
  description: string,
): Promise<boolean> {
  const episode: Episode = {
    name: `edit-${annotationId.slice(0, 8)}`,
    content: `DOCUMENT EDIT:\nDescription: ${description}\nBefore: "${beforeText}"\nAfter: "${afterText}"`,
    sourceDescription: 'intent-ide-edit',
    referenceTime: new Date().toISOString(),
  }

  try {
    await addEpisode(episode)
    return true
  } catch {
    return false
  }
}

function buildEpisodeBody(annotation: Annotation): string {
  const parts: string[] = [
    `ANNOTATION TYPE: ${annotation.type}`,
    `USER SAID: "${annotation.transcript}"`,
    `SELECTED TEXT: "${annotation.anchor.text}"`,
  ]

  if (annotation.resolution) {
    parts.push(`RESOLUTION: ${annotation.resolution.content}`)
    if (annotation.resolution.suggestedEdit) {
      parts.push(`SUGGESTED EDIT: "${annotation.resolution.suggestedEdit.newText}"`)
    }
  }

  if (annotation.conversation && annotation.conversation.length > 0) {
    const threadSummary = annotation.conversation
      .slice(-4) // Last 4 messages for context
      .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
      .join('\n')
    parts.push(`THREAD:\n${threadSummary}`)
  }

  return parts.join('\n')
}
