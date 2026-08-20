import type { EditorState } from 'prosemirror-state'
import { findBlockById } from '@/lib/prosemirror/blockIds'
import { primaryProposedEdit } from '@/lib/ai/orchestrator'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useChangesStore } from '@/stores/changesStore'
import { useDocumentStore } from '@/stores/documentStore'
import { useToastStore } from '@/stores/toastStore'
import { useInvariantFlagStore } from '@/stores/invariantFlagStore'
import { generateId } from '@/lib/utils/id'
import { listInvariants } from './captureInvariant'
import { checkInvariants, type InvariantViolation } from './invariantCheckRunner'
import type { Annotation, CascadeEvidence, ProposedEdit, ResolutionAction } from '@/lib/annotations/types'

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

/** Deterministic key for one (invariant, conflicting block) pair — the dedup unit. */
function violationKey(documentId: string, violation: InvariantViolation): string {
  return `${documentId}:invariant:${violation.invariantId}:${violation.conflictBlockId}`
}

/**
 * Whole-word verification that `numberToken` literally appears in the given
 * block's text — the same word-boundary discipline `containsTerm` applies to
 * subject terms, applied here to the citation itself. A bare contiguity
 * check (as `blockTextRange` does, by design, for arbitrary quoted phrases)
 * would let a short token like "30" spuriously "verify" against "2030" or
 * "$3,000" — a coincidental substring, not a real citation.
 */
function verifiesInBlock(blockText: string, numberToken: string): boolean {
  const idx = blockText.indexOf(numberToken)
  if (idx === -1) return false
  const before = idx > 0 ? blockText[idx - 1] : ' '
  const after = idx + numberToken.length < blockText.length ? blockText[idx + numberToken.length] : ' '
  return /\W/.test(before) && /\W/.test(after)
}

/**
 * Evidence is only ever set when the declared figure literally, word-
 * boundary-verifies against one of the blocks that declared it — an
 * unverifiable quote must not claim citation integrity (the same rule
 * `orchestrator.ts`'s `buildEvidence` enforces for every other cascade path:
 * "an uncited proposal can never be `must`"). Tries every evidence block, not
 * just the first, so losing one declaring block doesn't sink an otherwise-
 * verifiable citation. When nothing verifies (the exact wording drifted from
 * the source block since capture — the modal lets a user edit the captured
 * text — or the figure was reformatted), this degrades to NO evidence and
 * `'optional'` severity, matching `deriveSeverity`'s own convention
 * elsewhere in the codebase: no locatable citation is a lead, never a must.
 */
function verifiedEvidence(
  doc: EditorState['doc'],
  evidenceBlockIds: string[],
  statementNumber: string,
): { evidence: CascadeEvidence | null; severity: 'must' | 'optional' } {
  for (const sourceBlockId of evidenceBlockIds) {
    const block = findBlockById(doc, sourceBlockId)
    if (block && verifiesInBlock(block.node.textContent, statementNumber)) {
      return {
        evidence: { sourceBlockId, quotedText: statementNumber, edgeType: 'contradicts' },
        severity: 'must',
      }
    }
  }
  return { evidence: null, severity: 'optional' }
}

function conflictEdit(doc: EditorState['doc'], violation: InvariantViolation): ProposedEdit | null {
  const block = findBlockById(doc, violation.conflictBlockId)
  if (!block) return null
  const from = block.pos + 1
  const to = block.pos + block.node.nodeSize - 1
  const text = block.node.textContent
  const { evidence, severity } = verifiedEvidence(doc, violation.evidenceBlockIds, violation.statementNumber)
  return {
    id: generateId(),
    from,
    to,
    newText: text,
    reason: `Declared "${violation.statementNumber}", but this section says "${violation.conflictNumber}": "${violation.statement}"`,
    relation: 'cascade',
    status: 'pending',
    targetText: text,
    blockId: violation.conflictBlockId,
    severity,
    evidence,
  }
}

/** Anchors "why this proposal?" at whichever evidence block still resolves. */
function primaryAnchor(doc: EditorState['doc'], violation: InvariantViolation): ProposedEdit | null {
  for (const blockId of violation.evidenceBlockIds) {
    const block = findBlockById(doc, blockId)
    if (!block) continue
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
  return null
}

/**
 * Runs the deterministic doc-CI lane for a document against its current
 * editor state and appends one resolved 'flag' annotation per violated
 * invariant. Fire-and-forget: never throws into the caller (a DocCommit
 * write must never be blocked by a check-lane failure).
 *
 * Two guards keep this from becoming an unbounded nuisance:
 * - Doc-switch race: `state` is read from a caller-captured EditorView after
 *   an async round-trip (`listInvariants`); if the active document changed
 *   in the meantime, `state` and `documentId` would disagree — abort rather
 *   than tag a flag with the wrong document's id (same guard as the sibling
 *   `directEditCascade.ts`).
 * - Re-flag dedup: the check re-runs on every apply, so without a dedup an
 *   unresolved conflict would re-surface as a brand-new annotation on every
 *   future apply anywhere in the document, forever. Dedup state lives in its
 *   OWN store (`invariantFlagStore`), not derived from `annotationStore` —
 *   `DocInputModal.loadDoc()` unconditionally clears `annotationStore` on
 *   every new-document creation (a pre-existing, out-of-scope behavior), and
 *   deriving dedup from it would let starting an unrelated document revive
 *   every other document's already-seen flags. `checkInvariants` naturally
 *   stops returning a violation once the conflict is actually fixed, so a
 *   real fix still clears the underlying cause even though the flag record
 *   itself isn't retracted (Phase 1's ledger has no dismiss/resolve route —
 *   a named, disclosed follow-up, not silently assumed away).
 */
export async function runAndSurfaceInvariantChecks(
  documentId: string,
  state: EditorState,
): Promise<void> {
  try {
    if (useDocumentStore.getState().activeDocumentId !== documentId) return

    const invariants = await listInvariants(documentId)
    if (useDocumentStore.getState().activeDocumentId !== documentId) return

    const violations = checkInvariants(state.doc, invariants)
    if (violations.length === 0) return

    const flagStore = useInvariantFlagStore.getState()

    for (const violation of violations) {
      const key = violationKey(documentId, violation)
      if (flagStore.hasSurfaced(key)) continue

      const primary = primaryAnchor(state.doc, violation)
      const cascade = conflictEdit(state.doc, violation)
      // Both anchors must resolve against the live doc, or there is nothing
      // stable to point the flag at (e.g. every declaring block was since
      // deleted) — skip rather than surface a flag anchored to nothing.
      if (!primary || !cascade) continue

      const now = Date.now()
      const annotation: Annotation = {
        id: generateId(),
        documentId,
        locationGroupKey: key,
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
      flagStore.markSurfaced(key)
      useToastStore.getState().addToast('A declared fact may no longer hold — see Annotations', 'info')
    }
  } catch (err) {
    console.warn('[invariants] Check runner failed:', err)
  }
}
