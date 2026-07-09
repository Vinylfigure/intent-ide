import { Schema, MarkSpec, NodeSpec, DOMOutputSpec, Node as PMNode } from 'prosemirror-model'
import { nodes as basicNodes, marks as basicMarks } from 'prosemirror-schema-basic'
import { addListNodes } from 'prosemirror-schema-list'
import OrderedMap from 'orderedmap'

/** Block-level node types that carry a persistent `blockId` attr. */
export const BLOCK_ID_NODE_NAMES = [
  'paragraph',
  'heading',
  'blockquote',
  'code_block',
  'list_item',
] as const

function injectDataBlockId(out: DOMOutputSpec, blockId: string | null): DOMOutputSpec {
  if (blockId == null || !Array.isArray(out)) return out
  const [tag, ...rest] = out as [string, ...unknown[]]
  const maybeAttrs = rest[0]
  if (maybeAttrs && typeof maybeAttrs === 'object' && !Array.isArray(maybeAttrs)) {
    return [
      tag,
      { ...(maybeAttrs as Record<string, unknown>), 'data-block-id': blockId },
      ...rest.slice(1),
    ] as unknown as DOMOutputSpec
  }
  return [tag, { 'data-block-id': blockId }, ...rest] as unknown as DOMOutputSpec
}

// parseDOM is deliberately NOT extended with data-block-id: pasted/clipboard HTML
// must never carry a blockId into the doc, so pasted blocks arrive with null and
// the blockId plugin mints fresh ids (copy/paste can therefore never duplicate ids).
function withBlockId(spec: NodeSpec): NodeSpec {
  const baseToDOM = spec.toDOM
  return {
    ...spec,
    attrs: { ...(spec.attrs ?? {}), blockId: { default: null } },
    ...(baseToDOM
      ? {
          toDOM(node: PMNode): DOMOutputSpec {
            return injectDataBlockId(baseToDOM(node), node.attrs.blockId as string | null)
          },
        }
      : {}),
  }
}

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

let nodesWithBlockIds = listNodes
for (const name of BLOCK_ID_NODE_NAMES) {
  const spec = nodesWithBlockIds.get(name)
  if (spec) nodesWithBlockIds = nodesWithBlockIds.update(name, withBlockId(spec))
}

const marksMap = basicMarks instanceof OrderedMap
  ? basicMarks
  : OrderedMap.from(basicMarks as unknown as Record<string, MarkSpec>)

export const schema = new Schema({
  nodes: nodesWithBlockIds,
  marks: marksMap.update('annotation_highlight', annotationHighlight),
})
