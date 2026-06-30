import { Plugin, PluginKey, Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'
import type { AnnotationType } from '@/lib/annotations/types'

interface AnnotationAnchor {
  from: number
  to: number
  type: AnnotationType
}

interface AnnotationPluginState {
  decorations: DecorationSet
  anchors: Map<string, AnnotationAnchor>
}

export interface AnnotationMeta {
  action: 'add' | 'remove' | 'update'
  id: string
  from?: number
  to?: number
  type?: AnnotationType
}

export const annotationPluginKey = new PluginKey<AnnotationPluginState>('annotations')

function buildAnnotationDecoration(id: string, from: number, to: number, type: AnnotationType): Decoration {
  return Decoration.inline(from, to, {
    class: `annotation-highlight annotation-${type}`,
    'data-annotation-id': id,
  }, { annotationId: id })
}

export function createAnnotationPlugin(): Plugin {
  return new Plugin({
    key: annotationPluginKey,

    state: {
      init(): AnnotationPluginState {
        return {
          decorations: DecorationSet.empty,
          anchors: new Map(),
        }
      },

      apply(tr: Transaction, pluginState: AnnotationPluginState): AnnotationPluginState {
        let { decorations, anchors } = pluginState

        // Map existing decorations through transaction
        decorations = decorations.map(tr.mapping, tr.doc)

        // Map anchor positions
        const newAnchors = new Map<string, AnnotationAnchor>()
        for (const [id, anchor] of anchors) {
          newAnchors.set(id, {
            ...anchor,
            from: tr.mapping.map(anchor.from),
            to: tr.mapping.map(anchor.to),
          })
        }
        anchors = newAnchors

        // Handle meta commands
        const meta = tr.getMeta(annotationPluginKey) as AnnotationMeta | undefined
        if (meta) {
          if (meta.action === 'add' && meta.from !== undefined && meta.to !== undefined && meta.type) {
            anchors.set(meta.id, { from: meta.from, to: meta.to, type: meta.type })
            decorations = decorations.add(tr.doc, [
              buildAnnotationDecoration(meta.id, meta.from, meta.to, meta.type),
            ])
          }

          if (meta.action === 'remove') {
            anchors.delete(meta.id)
            const existing = decorations.find(
              undefined, undefined,
              (spec: any) => spec.annotationId === meta.id
            )
            decorations = decorations.remove(existing)
          }

          if (meta.action === 'update' && meta.type) {
            const anchor = anchors.get(meta.id)
            if (anchor) {
              anchors.set(meta.id, { ...anchor, type: meta.type })
              const existing = decorations.find(
                undefined, undefined,
                (spec: any) => spec.annotationId === meta.id
              )
              decorations = decorations.remove(existing)
              decorations = decorations.add(tr.doc, [
                buildAnnotationDecoration(meta.id, anchor.from, anchor.to, meta.type),
              ])
            }
          }
        }

        return { decorations, anchors }
      },
    },

    props: {
      decorations(state) {
        return annotationPluginKey.getState(state)?.decorations
      },
    },
  })
}

// Helper to add an annotation decoration
export function addAnnotationDecoration(
  view: EditorView,
  id: string,
  from: number,
  to: number,
  type: AnnotationType,
) {
  const tr = view.state.tr.setMeta(annotationPluginKey, {
    action: 'add', id, from, to, type,
  } as AnnotationMeta)
  view.dispatch(tr)
}

// Helper to remove an annotation decoration
export function removeAnnotationDecoration(view: EditorView, id: string) {
  const tr = view.state.tr.setMeta(annotationPluginKey, {
    action: 'remove', id,
  } as AnnotationMeta)
  view.dispatch(tr)
}
