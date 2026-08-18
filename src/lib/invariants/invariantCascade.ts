import type { EditorState } from 'prosemirror-state'
import { findBlockById } from '@/lib/prosemirror/blockIds'
import { primaryProposedEdit } from '@/lib/ai/orchestrator'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useChangesStore } from '@/stores/changesStore'
import { generateId } from '@/lib/utils/id'
import { listInvariants } from './captureInvariant'
import { checkInvariants, type InvariantViolation } from './invariantCheckRunner'
import type { Annotation, ProposedEdit, ResolutionAction } from '@/lib/annotations/types'

/**
 * Document Invariant Ledger — Phase 2 (issue #32): surfaces a failing
 * deterministic check through the existing single CascadeList surface,
 * exactly as the Flow v1 direct-edit trigger (`directEditCascade.ts`) does.
 * No new UI path — the "one cascade surface" rule (Wave D2) holds.
 *
 * HITL: doc-CI flags, it never edits. The primary anchor is pre-marked
 * 'rejected' (nothing to apply — it just anchors "why this proposal?" at the
 * block that declared the fact) and the cascade edit is a no-op
 * (targetText === newText), so accepting the flag can never mutate the
 * document; it only marks the flag reviewed.
 */

const FLAG_ACTIONS: ResolutionAction[] = [
  { label: 'Show affected', kind: 'deepen', handler: 'show-cascade' },
  { label: 'Nevermind', kind: 'dismiss', handler: 'dismiss' },
]

function conflictEdit(doc: EditorState['doc'], violation: InvariantViolation): ProposedEdit | null {
  const block = findBlockById(doc, violation.conflictBlockId)
  if (!block) return null
  const from = block.pos + 1
  const to = block.pos + block.node.nodeSize - 1
  const text = block.node.textContent
  return {
    id: generateId(),
    from,
    to,
    newText: text,
    reason: `Conflicts with a declared fact: "${violation.statement}"`,
    relation: 'cascade',
    status: 'pending',
    targetText: text,
    blockId: violation.conflictBlockId,
    severity: 'must',
    evidence: {
      sourceBlockId: violation.evidenceBlockIds[0] ?? violation.conflictBlockId,
      quotedText: violation.statement,
      edgeType: 'contradicts',
    },
  }
}

function primaryAnchor(doc: EditorState['doc'], violation: InvariantViolation): ProposedEdit | null {
  const blockId = violation.evidenceBlockIds[0]
  if (!blockId) return null
  const block = findBlockById(doc, blockId)
  if (!block) return null
  const from = block.pos + 1
  const to = block.pos + block.node.nodeSize - 1
  const text = block.node.textContent
  return {
    ...primaryProposedEdit(
      { from, to, newText: text, reason: `Declared: "${violation.statement}"` },
      text,
      blockId,
    ),
    status: 'rejected',
  }
}

/**
 * Runs the deterministic doc-CI lane for a document against its current
 * editor state and appends one resolved 'flag' annotation per violated
 * invariant. Fire-and-forget: never throws into the caller (a DocCommit
 * write must never be blocked by a check-lane failure).
 */
export async function runAndSurfaceInvariantChecks(
  documentId: string,
  state: EditorState,
): Promise<void> {
  try {
    const invariants = await listInvariants(documentId)
    const violations = checkInvariants(state.doc, invariants)

    for (const violation of violations) {
      const primary = primaryAnchor(state.doc, violation)
      const cascade = conflictEdit(state.doc, violation)
      // Both anchors must resolve against the live doc, or there is nothing
      // stable to point the flag at (e.g. the declaring block was since
      // deleted) — skip rather than surface a flag anchored to nothing.
      if (!primary || !cascade) continue

      const now = Date.now()
      const annotation: Annotation = {
        id: generateId(),
        documentId,
        locationGroupKey: `${documentId}:invariant:${violation.invariantId}:${now}`,
        type: 'flag',
        status: 'resolved',
        transcript: `Declared fact may no longer hold: "${violation.statement}"`,
        anchor: { from: cascade.from, to: cascade.to, scope: 'paragraph', text: cascade.targetText },
        resolution: {
          type: 'flag',
          content: `A section conflicts with a fact you declared earlier: "${violation.statement}". Review below.`,
          suggestedEdit: null,
          edits: [primary, cascade],
          actions: FLAG_ACTIONS,
        },
        conversation: [],
        parentId: null,
        childIds: [],
        createdAt: now,
        resolvedAt: now,
        verbosity: 'normal',
      }

      useAnnotationStore.getState().add(annotation)
      useChangesStore.getState().ensureChangeSetForAnnotation(annotation)
    }
  } catch (err) {
    console.warn('[invariants] Check runner failed:', err)
  }
}
