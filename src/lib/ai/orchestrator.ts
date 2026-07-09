import type { EditorState } from 'prosemirror-state'
import type { ProposedEdit, SuggestedEdit } from '@/lib/annotations/types'
import type { LLMConfig } from '@/stores/settingsStore'
import { findTextInDoc } from '@/lib/prosemirror/applyProposedEdits'

/**
 * Turns the read-only cascade check into editable multi-region proposals.
 *
 * After the resolving agent produces the primary edit, this asks the model (via
 * the provider-agnostic `propose_edit` tool) which OTHER regions of the document
 * become inconsistent and how to fix them — one structured edit per region. Each
 * cascade edit is anchored to live ProseMirror positions by fingerprint-matching
 * the model's verbatim `target_text`; regions that can't be located, or that
 * overlap the primary edit, are dropped rather than guessed.
 */

const PROPOSE_EDIT_TOOL = {
  name: 'propose_edit',
  description:
    'Propose a change to a region of the document that becomes inconsistent because of the primary edit. Call once per distinct affected region. Only propose edits where a figure, claim, name, or statement repeated elsewhere must be brought into agreement with the primary edit.',
  input_schema: {
    type: 'object',
    properties: {
      target_text: {
        type: 'string',
        description:
          'The exact existing text to replace — a short, unique phrase or sentence copied verbatim from the document so it can be located precisely.',
      },
      new_text: { type: 'string', description: 'The replacement text for that region.' },
      reason: { type: 'string', description: 'Why this region must change given the primary edit.' },
    },
    required: ['target_text', 'new_text', 'reason'],
  },
}

const CASCADE_SYSTEM =
  'You keep a document internally consistent. Given a primary edit the user just made, find OTHER regions of the provided document that become inconsistent, outdated, or contradictory as a result, and call propose_edit once for each. Copy target_text verbatim from the document. Never propose an edit to the primary region itself. If nothing else needs to change, call nothing.'

function newId(): string {
  try {
    return `pe_${crypto.randomUUID()}`
  } catch {
    return `pe_${Math.random().toString(36).slice(2)}`
  }
}

/** Build the primary ProposedEdit from the resolving agent's suggested edit. */
export function primaryProposedEdit(
  edit: SuggestedEdit,
  targetText: string,
  blockId?: string,
): ProposedEdit {
  return {
    id: newId(),
    from: edit.from,
    to: edit.to,
    newText: edit.newText,
    reason: edit.reason,
    relation: 'primary',
    status: 'pending',
    targetText,
    ...(blockId ? { blockId } : {}),
    // The primary edit is the user's own intent — always 'must', self-evidencing.
    severity: 'must',
    evidence: null,
  }
}

interface ToolCallInput {
  target_text?: string
  new_text?: string
  reason?: string
}

/**
 * Ask the model for cascade edits and anchor each to live document positions.
 * Returns only edits that could be located and don't overlap the primary range.
 */
export async function proposeCascadeEdits(
  state: EditorState,
  primary: SuggestedEdit,
  docText: string,
  config: LLMConfig,
): Promise<ProposedEdit[]> {
  const primaryBefore = state.doc.textBetween(
    Math.min(primary.from, state.doc.content.size),
    Math.min(primary.to, state.doc.content.size),
  )

  const userPrompt = [
    'PRIMARY EDIT (just applied or about to apply):',
    `- Was: "${primaryBefore}"`,
    `- Now: "${primary.newText}"`,
    '',
    'DOCUMENT:',
    docText,
  ].join('\n')

  let toolCalls: { name: string; input: ToolCallInput }[] = []
  try {
    const res = await fetch('/api/structured', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'x-provider': config.provider,
        'x-model': config.model,
        ...(config.baseUrl ? { 'x-base-url': config.baseUrl } : {}),
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: CASCADE_SYSTEM },
          { role: 'user', content: userPrompt },
        ],
        tools: [PROPOSE_EDIT_TOOL],
        maxTokens: 1500,
        temperature: 0.2,
      }),
    })
    if (!res.ok) return []
    const data = await res.json()
    toolCalls = Array.isArray(data.toolCalls) ? data.toolCalls : []
  } catch {
    return []
  }

  const edits: ProposedEdit[] = []
  for (const call of toolCalls) {
    if (call.name !== 'propose_edit') continue
    const targetText = call.input?.target_text?.trim()
    const newText = call.input?.new_text
    if (!targetText || newText === undefined) continue

    const located = findTextInDoc(state.doc, targetText)
    if (!located) continue // unanchorable — drop rather than guess
    // Skip anything overlapping the primary range to avoid double-editing it.
    if (located.from < primary.to && located.to > primary.from) continue

    edits.push({
      id: newId(),
      from: located.from,
      to: located.to,
      newText,
      reason: call.input?.reason ?? 'Consistency with the primary edit.',
      relation: 'cascade',
      status: 'pending',
      targetText,
      // Placeholder until graph-scoped severity derivation lands: whole-doc
      // cascade proposals are uncited, so they can never be 'must'.
      severity: 'probably',
      evidence: null,
    })
  }
  return edits
}

/** Assemble the full edit set for a resolution: primary first, then cascades. */
export function assembleResolutionEdits(
  primary: ProposedEdit,
  cascades: ProposedEdit[],
): ProposedEdit[] {
  return [primary, ...cascades]
}
