import type { EditorState } from 'prosemirror-state'
import { primaryProposedEdit, proposeCascadeEdits } from '@/lib/ai/orchestrator'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useDocumentStore } from '@/stores/documentStore'
import { useChangesStore } from '@/stores/changesStore'
import { useToastStore } from '@/stores/toastStore'
import { generateId } from '@/lib/utils/id'
import type { Annotation, ResolutionAction, SuggestedEdit } from './types'
import type { DirectEditOffer } from './directEditTrigger'

/**
 * User-consented arm of the direct-edit cascade trigger (Flow v1 P4): runs
 * ONLY after the user clicks Check on the offer chip. Proposes cascade edits
 * for an ALREADY-APPLIED human edit and surfaces them through the existing
 * annotation → CascadeList → SemanticCommitModal review flow (HITL preserved —
 * nothing here mutates the document).
 */

// Copied verbatim from resolver.ts ACTIONS_BY_TYPE['edit'] (resolver.ts:77-81)
// — that table is module-private. If the resolver's edit actions change,
// update this copy too.
const EDIT_ACTIONS: ResolutionAction[] = [
  { label: 'Apply', kind: 'apply', handler: 'apply-edit' },
  { label: 'Tweak it', kind: 'deepen', handler: 'tweak' },
  { label: 'Show affected', kind: 'deepen', handler: 'show-cascade' },
  { label: 'Nevermind', kind: 'dismiss', handler: 'dismiss' },
]

const TRANSCRIPT_SLICE = 60

function truncate(text: string): string {
  return text.length > TRANSCRIPT_SLICE ? `${text.slice(0, TRANSCRIPT_SLICE - 1)}…` : text
}

/** Injectable seam for tests — defaults to the real orchestrator call. */
export type ProposeCascadesFn = typeof proposeCascadeEdits

export async function runDirectEditCascade(
  view: { state: EditorState },
  offer: DirectEditOffer,
  propose: ProposeCascadesFn = proposeCascadeEdits,
): Promise<void> {
  const config = useSettingsStore.getState().llmConfig

  // The user's own applied edit, replayed as the cascade's primary. The live
  // doc already holds the NEW text at this range, hence primaryBefore below.
  const primarySuggested: SuggestedEdit = {
    from: offer.from,
    to: offer.to,
    newText: offer.blockText,
    reason: 'Your direct edit (already applied)',
  }

  // The ONLY network step in the whole feature — post-consent by construction.
  const cascades = await propose(view.state, primarySuggested, config, {
    primaryBefore: offer.beforeText,
  })

  if (cascades.length === 0) {
    useToastStore.getState().addToast('No dependent changes needed', 'info')
    return
  }

  const documentId = useDocumentStore.getState().activeDocumentId ?? 'unknown'
  const now = Date.now()

  // Primary edit is a no-op placeholder (targetText === newText === current
  // block text) pre-marked 'rejected', so it starts toggled OFF in the commit
  // modal and can never re-apply the user's own edit — only the cascades are
  // live review subjects.
  const primary = {
    ...primaryProposedEdit(primarySuggested, offer.blockText, offer.blockId),
    status: 'rejected' as const,
  }

  const annotation: Annotation = {
    id: generateId(),
    documentId,
    locationGroupKey: `${documentId}:${offer.from}:${offer.to}`,
    type: 'edit',
    status: 'resolved',
    transcript: `Direct edit: "${truncate(offer.beforeText)}" → "${truncate(offer.blockText)}"`,
    anchor: { from: offer.from, to: offer.to, scope: 'paragraph', text: offer.blockText },
    resolution: {
      type: 'edit',
      content: 'You changed this section. Review the dependent sections below.',
      suggestedEdit: primarySuggested,
      edits: [primary, ...cascades],
      actions: EDIT_ACTIONS,
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
  useAnnotationStore.getState().setActive(annotation.id)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('intent-ide:scroll-to-annotation', { detail: annotation.id }),
    )
  }
}
