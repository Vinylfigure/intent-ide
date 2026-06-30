import { Schema, MarkSpec, NodeSpec, DOMOutputSpec } from 'prosemirror-model'
import { nodes as basicNodes, marks as basicMarks } from 'prosemirror-schema-basic'
import { addListNodes } from 'prosemirror-schema-list'
import OrderedMap from 'orderedmap'

const annotationHighlight: MarkSpec = {
  attrs: {
    annotationId: { default: null },
    type: { default: 'ask' },
  },
  inclusive: false,
  parseDOM: [{
    tag: 'span.annotation-highlight',
    getAttrs(dom) {
      const el = dom as HTMLElement
      return {
        annotationId: el.getAttribute('data-annotation-id'),
        type: el.getAttribute('data-annotation-type') || 'ask',
      }
    },
  }],
  toDOM(mark): DOMOutputSpec {
    return ['span', {
      class: `annotation-highlight annotation-${mark.attrs.type}`,
      'data-annotation-id': mark.attrs.annotationId,
      'data-annotation-type': mark.attrs.type,
    }, 0]
  },
}

// addListNodes expects OrderedMap — convert if needed
const nodesMap = basicNodes instanceof OrderedMap
  ? basicNodes
  : OrderedMap.from(basicNodes as unknown as Record<string, NodeSpec>)

const listNodes = addListNodes(nodesMap, 'paragraph block*', 'block')

const marksMap = basicMarks instanceof OrderedMap
  ? basicMarks
  : OrderedMap.from(basicMarks as unknown as Record<string, MarkSpec>)

export const schema = new Schema({
  nodes: listNodes,
  marks: marksMap.update('annotation_highlight', annotationHighlight),
})
