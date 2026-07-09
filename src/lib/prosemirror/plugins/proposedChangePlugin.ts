import { Plugin, PluginKey, Transaction, EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'
import { readLinePluginKey } from './readLinePlugin'
import { useProposedEditUiStore } from '@/stores/proposedEditUiStore'
import type {
  CascadeEvidence,
  CascadeSeverity,
  ProposedEdit,
  ProposedEditRelation,
  ProposedEditStatus,
} from '@/lib/annotations/types'

/**
 * Renders multi-region agent proposals as "called out" inline decorations
 * (PRD Read-Line + Cascade model). Each pending edit is highlighted; whether it
 * shows as a flagged margin callout ("you already read this changed") or a quiet
 * highlight is derived at decoration time from the edit's position relative to
 * the read-line high-water mark — never stored, so it stays correct as reading
 * advances. Positions are re-mapped through `tr.mapping` every transaction so the
 * callouts survive concurrent typing, and `applyProposedEdits` reads these live
 * positions (not the stale stored ones) at apply time.
 */

export interface ProposedAnchor {
  from: number
  to: number
  relation: ProposedEditRelation
  status: ProposedEditStatus
  /** Text the edit expects to replace — validated before any mutation. */
  targetText: string
  newText: string
  reason: string
  severity: CascadeSeverity
  evidence: CascadeEvidence | null
  blockId?: string
}

interface ProposedChangeState {
  anchors: Map<string, ProposedAnchor>
}

export interface ProposedChangeMeta {
  action: 'setEdits' | 'setStatus' | 'clearAll'
  edits?: ProposedEdit[]
  id?: string
  status?: ProposedEditStatus
}

export const proposedChangePluginKey = new PluginKey<ProposedChangeState>('proposedChanges')

/** True when `pos` sits above the reader's high-water mark (already-read region). */
function isAboveReadLine(state: EditorState, pos: number): boolean {
  const rl = readLinePluginKey.getState(state)
  if (!rl || rl.highWaterMark === 0) return false
  return pos < rl.highWaterMark
}

function buildDecorations(state: EditorState, anchors: Map<string, ProposedAnchor>): DecorationSet {
  const decos: Decoration[] = []
  for (const [id, a] of anchors) {
    // Rejected edits are not rendered; pending + accepted are.
    if (a.status === 'rejected') continue
    if (a.from === a.to) continue
    const above = isAboveReadLine(state, a.from)
    const accepted = a.status === 'accepted'
    decos.push(
      Decoration.inline(
        a.from,
        a.to,
        {
          class: `proposed-edit proposed-edit-${a.relation} proposed-severity-${a.severity} ${above ? 'proposed-above' : 'proposed-below'}${accepted ? ' proposed-accepted' : ''}`,
          'data-proposed-edit-id': id,
          title: above
            ? 'Something you already read was modified'
            : 'Proposed change',
        },
        { proposedEditId: id },
      ),
    )
    if (above && !accepted) {
      // Margin flag widget for already-read changes.
      decos.push(
        Decoration.widget(
          a.from,
          () => {
            const el = document.createElement('span')
            el.className = 'proposed-edit-flag'
            el.setAttribute('data-proposed-edit-id', id)
            el.title = 'Something you already read was modified'
            return el
          },
          { side: -1, key: `proposed-flag-${id}` },
        ),
      )
    }
  }
  return DecorationSet.create(state.doc, decos)
}

export function createProposedChangePlugin(): Plugin {
  return new Plugin({
    key: proposedChangePluginKey,

    state: {
      init(): ProposedChangeState {
        return { anchors: new Map() }
      },

      apply(tr: Transaction, pluginState: ProposedChangeState): ProposedChangeState {
        let anchors = pluginState.anchors

        // Map all anchor positions through the transaction so callouts follow edits.
        if (tr.docChanged) {
          const mapped = new Map<string, ProposedAnchor>()
          for (const [id, a] of anchors) {
            mapped.set(id, {
              ...a,
              from: tr.mapping.map(a.from),
              to: tr.mapping.map(a.to),
            })
          }
          anchors = mapped
        }

        const meta = tr.getMeta(proposedChangePluginKey) as ProposedChangeMeta | undefined
        if (meta) {
          if (meta.action === 'setEdits') {
            anchors = new Map()
            for (const e of meta.edits ?? []) {
              anchors.set(e.id, {
                from: e.from,
                to: e.to,
                relation: e.relation,
                status: e.status,
                targetText: e.targetText,
                newText: e.newText,
                reason: e.reason,
                severity: e.severity ?? (e.relation === 'primary' ? 'must' : 'probably'),
                evidence: e.evidence ?? null,
                blockId: e.blockId,
              })
            }
          } else if (meta.action === 'setStatus' && meta.id && meta.status) {
            const existing = anchors.get(meta.id)
            if (existing) {
              anchors = new Map(anchors)
              anchors.set(meta.id, { ...existing, status: meta.status })
            }
          } else if (meta.action === 'clearAll') {
            anchors = new Map()
          }
        }

        return { anchors }
      },
    },

    props: {
      decorations(state) {
        const ps = proposedChangePluginKey.getState(state)
        if (!ps) return DecorationSet.empty
        return buildDecorations(state, ps.anchors)
      },

      handleDOMEvents: {
        mouseover(_view: EditorView, event: Event) {
          const target = (event.target as HTMLElement).closest?.('[data-proposed-edit-id]')
          if (target) {
            const id = target.getAttribute('data-proposed-edit-id')
            if (id) {
              useProposedEditUiStore.getState().setHovered(id)
            }
          }
          return false
        },
        mouseout(_view: EditorView, event: Event) {
          const target = (event.target as HTMLElement).closest?.('[data-proposed-edit-id]')
          if (target) {
            useProposedEditUiStore.getState().setHovered(null)
          }
          return false
        },
        click(_view: EditorView, event: Event) {
          const target = (event.target as HTMLElement).closest?.('[data-proposed-edit-id]')
          if (target) {
            const id = target.getAttribute('data-proposed-edit-id')
            if (id) {
              const store = useProposedEditUiStore.getState()
              // Toggle: click again to close
              store.setActive(store.activeId === id ? null : id)
              return true
            }
          }
          return false
        },
      },
    },
  })
}

// --- Helpers --------------------------------------------------------------

/** Show a resolution's proposed edits as decorations. */
export function setProposedEdits(view: EditorView, edits: ProposedEdit[]) {
  view.dispatch(
    view.state.tr.setMeta(proposedChangePluginKey, {
      action: 'setEdits',
      edits,
    } as ProposedChangeMeta),
  )
}

/** Update one edit's review status (accepted/rejected). */
export function setProposedEditStatus(view: EditorView, id: string, status: ProposedEditStatus) {
  view.dispatch(
    view.state.tr.setMeta(proposedChangePluginKey, {
      action: 'setStatus',
      id,
      status,
    } as ProposedChangeMeta),
  )
}

/** Remove all proposed-edit decorations. */
export function clearProposedEdits(view: EditorView) {
  view.dispatch(
    view.state.tr.setMeta(proposedChangePluginKey, { action: 'clearAll' } as ProposedChangeMeta),
  )
}

/** Live (transaction-mapped) anchors keyed by edit id, or empty map. */
export function getProposedAnchors(state: EditorState): Map<string, ProposedAnchor> {
  return proposedChangePluginKey.getState(state)?.anchors ?? new Map()
}
