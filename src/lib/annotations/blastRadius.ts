import type { EditorState } from 'prosemirror-state'
import { blockIdAtPos } from '@/lib/prosemirror/blockIds'
import { collectRelatedDetail, type RelatedPassage } from '@/lib/ai/intentContext'
import { useDocGraphStore } from '@/stores/docGraphStore'

export type { RelatedPassage }

/** Default cap on passages returned — glanceable, not exhaustive. */
const DEFAULT_CAP = 4

/**
 * Preview cap. Deliberately shorter than any of intentContext's per-scope
 * chars budgets: this text is read at a glance on the resolution card before
 * a decision, not fed to a model as prompt context.
 */
const PREVIEW_CHARS = 160

/** Preview hop radius — mirrors the resolver's default, not the tighter
 *  one-hop popup count (peekRelatedCount): a pre-decision preview should show
 *  the same neighbourhood the post-apply cascade check would find. */
const PREVIEW_HOPS = 2

/**
 * What the resolution card shows BEFORE the human decides whether to apply an
 * edit: "what else in the document does this touch?" Today that question is
 * only answered AFTER the edit lands (ResolutionActions' post-apply
 * `runCascadeCheck`), so the human commits first and learns the blast radius
 * second. This answers it early, from the same ranked index
 * (`collectRelated`) the resolver's own context envelope uses, so the
 * pre-decision preview and the answering path never quietly disagree about
 * what "related" means.
 *
 * Synchronous and side-effect free: reads the live doc graph and the current
 * doc only, never writes to `conflictStore`, decorations, or the cascade
 * check. Returns `[]` whenever the graph is cold, the position's block is
 * unknown, or the block isn't in the graph — callers must treat that as "say
 * nothing", not "nothing is related".
 */
export interface BlastRadiusPreview {
  passages: RelatedPassage[]
  /** Candidates the graph offered that scored below the relevance floor. */
  suppressed: number
  /**
   * True when the graph was cold or the block unknown to it. The card must
   * render NOTHING in this state — an empty list here means "not known yet",
   * and telling a reader "nothing depends on this" on the strength of an
   * unbuilt index is a false statement, not a cautious one.
   */
  graphUnavailable: boolean
}

export function previewBlastRadiusDetail(
  editorState: EditorState,
  pos: number,
  cap: number = DEFAULT_CAP,
): BlastRadiusPreview {
  const graph = useDocGraphStore.getState().graph
  if (!graph) return { passages: [], suppressed: 0, graphUnavailable: true }

  const blockId = blockIdAtPos(editorState.doc, pos)
  if (!blockId || !graph.nodes.has(blockId)) {
    return { passages: [], suppressed: 0, graphUnavailable: true }
  }

  const result = collectRelatedDetail(graph, blockId, {
    passages: cap,
    chars: PREVIEW_CHARS,
    hops: PREVIEW_HOPS,
  })
  return { passages: result.passages, suppressed: result.suppressed, graphUnavailable: false }
}

/** Just the passages — the shape callers had before suppression was tracked. */
export function previewBlastRadius(
  editorState: EditorState,
  pos: number,
  cap: number = DEFAULT_CAP,
): RelatedPassage[] {
  return previewBlastRadiusDetail(editorState, pos, cap).passages
}
