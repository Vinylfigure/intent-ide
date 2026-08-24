import type { Node as PMNode } from 'prosemirror-model'

export interface OutlineHeading {
  /** Document position of the heading node. */
  pos: number
  level: number
  text: string
  /** Position as a fraction of doc length, 0..1 — where it sits on the map. */
  position: number
}

/** Collect every heading in document order, with proportional positions. */
export function collectHeadings(doc: PMNode): OutlineHeading[] {
  const size = doc.content.size || 1
  const headings: OutlineHeading[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      headings.push({
        pos,
        level: (node.attrs.level as number) ?? 1,
        text: node.textContent,
        position: pos / size,
      })
      return false
    }
    return true
  })
  return headings
}

/**
 * Which headings get a text label on the map. The map is proportional, so
 * headings in a dense run would overprint each other's labels; a heading keeps
 * its label only when it sits at least `minGapFraction` below the previous
 * labelled one — the rest render as bare ticks. Parallel to the input array.
 */
export function visibleHeadingLabels(headings: OutlineHeading[], minGapFraction = 0.04): boolean[] {
  let lastLabelled = Number.NEGATIVE_INFINITY
  return headings.map((heading) => {
    if (heading.position - lastLabelled >= minGapFraction) {
      lastLabelled = heading.position
      return true
    }
    return false
  })
}
