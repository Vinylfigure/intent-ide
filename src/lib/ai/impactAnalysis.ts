import { EditorView } from 'prosemirror-view'
import { useSettingsStore } from '@/stores/settingsStore'
import { useConflictStore, type ConflictSeverity } from '@/stores/conflictStore'
import { addConflictDecoration, clearAllConflictDecorations } from '@/lib/prosemirror/plugins/conflictPlugin'
import { generateId } from '@/lib/utils/id'
import { IMPACT_ANALYSIS_PROMPT, IMPACT_ANALYSIS_WITH_REWRITES_PROMPT } from './prompts'
import type { LLMMessage } from './client'

export interface AnalysisConflict {
  text: string
  severity: 'direct' | 'ambiguous'
  reasoning: string
  proposedText?: string
}

/**
 * Find the position of a text snippet in the ProseMirror document.
 * Returns { from, to } or null if not found.
 */
function findTextInDoc(view: EditorView, snippet: string): { from: number; to: number } | null {
  const doc = view.state.doc
  const fullText = doc.textContent
  const index = fullText.indexOf(snippet)
  if (index === -1) return null

  // Map string index to ProseMirror position
  // Walk through doc nodes to find the position offset
  let charCount = 0
  let result: { from: number; to: number } | null = null

  doc.descendants((node, pos) => {
    if (result) return false
    if (node.isText && node.text) {
      const nodeStart = charCount
      const nodeEnd = charCount + node.text.length
      if (index >= nodeStart && index < nodeEnd) {
        const offset = index - nodeStart
        const from = pos + offset
        const snippetEnd = index + snippet.length
        // Snippet might span multiple text nodes, so use the minimum of node end and snippet end
        const to = from + Math.min(snippet.length, node.text.length - offset)
        result = { from, to: Math.min(from + snippet.length, doc.content.size) }
      }
      charCount = nodeEnd
    }
  })

  return result
}

/**
 * Parse the LLM response into structured conflicts.
 * Expects JSON array in a ```json code fence or bare JSON.
 */
function parseConflictResponse(content: string): AnalysisConflict[] {
  // Try to extract JSON from code fence
  const fenceMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  const jsonStr = fenceMatch ? fenceMatch[1].trim() : content.trim()

  try {
    const parsed = JSON.parse(jsonStr)
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item: Record<string, unknown>) =>
          typeof item.text === 'string' &&
          typeof item.severity === 'string' &&
          typeof item.reasoning === 'string'
      ) as AnalysisConflict[]
    }
  } catch {
    // Attempt to find array in the content
    const arrayMatch = content.match(/\[[\s\S]*\]/)
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0])
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (item: Record<string, unknown>) =>
              typeof item.text === 'string' &&
              typeof item.severity === 'string' &&
              typeof item.reasoning === 'string'
          ) as AnalysisConflict[]
        }
      } catch {
        // Give up
      }
    }
  }

  return []
}

/**
 * Run impact analysis on the document.
 * @param view - The ProseMirror EditorView
 * @param intent - The user's new intent/change description
 * @param withRewrites - If true, also propose replacement text for direct conflicts
 * @returns Number of conflicts found
 */
export async function runImpactAnalysis(
  view: EditorView,
  intent: string,
  withRewrites: boolean = false,
): Promise<number> {
  const config = useSettingsStore.getState().llmConfig
  const docText = view.state.doc.textContent

  if (!docText.trim()) return 0

  const prompt = withRewrites
    ? IMPACT_ANALYSIS_WITH_REWRITES_PROMPT
    : IMPACT_ANALYSIS_PROMPT

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: prompt,
    },
    {
      role: 'user',
      content: `INTENT (the change or rule the user wants to apply):\n"${intent}"\n\nDOCUMENT:\n${docText}`,
    },
  ]

  const response = await fetch('/api/resolve', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'x-provider': config.provider,
      'x-model': config.model,
      ...(config.baseUrl ? { 'x-base-url': config.baseUrl } : {}),
    },
    body: JSON.stringify({ messages, maxTokens: 1500, temperature: 0.2 }),
  })

  if (!response.ok) {
    throw new Error(`Impact analysis failed: ${response.statusText}`)
  }

  const data = await response.json()
  const conflicts = parseConflictResponse(data.content)

  // Clear existing conflicts before adding new ones
  clearAllConflictDecorations(view)
  useConflictStore.getState().clearAll()

  let count = 0
  for (const conflict of conflicts) {
    const pos = findTextInDoc(view, conflict.text)
    if (!pos) continue

    const id = generateId()
    const severity: ConflictSeverity = conflict.severity === 'direct' ? 'direct' : 'ambiguous'

    addConflictDecoration(view, id, pos.from, pos.to, severity)
    useConflictStore.getState().addConflict({
      id,
      from: pos.from,
      to: pos.to,
      severity,
      reasoning: conflict.reasoning,
      annotationId: null,
      resolution: 'pending',
      proposedText: conflict.proposedText ?? null,
    })

    count++
  }

  return count
}
