import { describe, it, expect } from 'vitest'
import { buildPanelRows } from '../AnnotationPanel'
import { annotationLabel } from '@/lib/annotations/subject'
import type { Annotation } from '@/lib/annotations/types'

// Depth used to be drawn as `marginLeft: min(depth,5)rem` inside a ~400px rail.
// Readable prose runs 45-75 characters and degrades below about 45, so five
// levels of indent did not merely look cramped — it pushed the text column
// under the legibility floor. These tests pin the replacement: fold anything
// past MAX_INLINE_DEPTH into one row rather than rendering it inline.

function ann(id: string, parentId: string | null): Annotation {
  return {
    id,
    documentId: 'doc',
    locationGroupKey: 'doc:10:31',
    type: 'ask',
    status: 'resolved',
    transcript: `question ${id}`,
    anchor: { from: 10, to: 31, scope: 'sentence', text: 'What is tokenization?' },
    resolution: null,
    conversation: [],
    parentId,
    childIds: [],
    createdAt: 0,
    resolvedAt: null,
    verbosity: 'normal',
  }
}

/** A straight chain root → c1 → c2 → ... of `n` links, DFS-ordered. */
function chain(n: number): { annotations: Annotation[]; depths: Map<string, number> } {
  const annotations: Annotation[] = [ann('root', null)]
  const depths = new Map<string, number>([['root', 0]])
  let parent = 'root'
  for (let i = 1; i <= n; i++) {
    const id = `c${i}`
    annotations.push(ann(id, parent))
    depths.set(id, i)
    parent = id
  }
  return { annotations, depths }
}

describe('buildPanelRows', () => {
  it('renders a shallow thread entirely inline', () => {
    const { annotations, depths } = chain(3)
    const rows = buildPanelRows(annotations, depths)
    expect(rows).toHaveLength(4)
    expect(rows.every((r) => r.kind === 'card')).toBe(true)
  })

  it('renders depth 5 inline and folds everything past it', () => {
    const { annotations, depths } = chain(8)
    const rows = buildPanelRows(annotations, depths)
    const cards = rows.filter((r) => r.kind === 'card')
    const folds = rows.filter((r) => r.kind === 'fold')

    // root + depths 1..5 stay inline; 6, 7, 8 collapse into a single row.
    expect(cards).toHaveLength(6)
    expect(folds).toHaveLength(1)
    expect(folds[0]).toMatchObject({ count: 3 })
  })

  it('anchors the fold on the deepest still-inline ancestor, so entering it re-roots there', () => {
    const { annotations, depths } = chain(7)
    const fold = buildPanelRows(annotations, depths).find((r) => r.kind === 'fold')
    expect(fold).toBeDefined()
    if (fold?.kind === 'fold') expect(fold.anchorId).toBe('c5')
  })

  it('does not let a deep subtree bleed into a following sibling', () => {
    // root ─┬─ a (1) ── deep chain to 6
    //       └─ b (1)
    const annotations = [
      ann('root', null),
      ann('a1', 'root'),
      ann('a2', 'a1'),
      ann('a3', 'a2'),
      ann('a4', 'a3'),
      ann('a5', 'a4'),
      ann('a6', 'a5'),
      ann('b1', 'root'),
    ]
    const depths = new Map<string, number>([
      ['root', 0], ['a1', 1], ['a2', 2], ['a3', 3], ['a4', 4], ['a5', 5], ['a6', 6], ['b1', 1],
    ])
    const rows = buildPanelRows(annotations, depths)
    const last = rows[rows.length - 1]
    expect(last.kind).toBe('card')
    if (last.kind === 'card') expect(last.annotation.id).toBe('b1')
    expect(rows.filter((r) => r.kind === 'fold')).toHaveLength(1)
  })

  it('treats a missing depth as a root rather than dropping the card', () => {
    const rows = buildPanelRows([ann('orphan', null)], new Map())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'card', depth: 0 })
  })

  it('handles an empty thread list', () => {
    expect(buildPanelRows([], new Map())).toEqual([])
  })
})

describe('annotationLabel', () => {
  it("prefers the reader's own question, which is what locates you in a breadcrumb", () => {
    const a = ann('x', 'root')
    a.transcript = 'is the token in this context a hash value?'
    const label = annotationLabel(a)
    expect(label.startsWith('is the token in this context')).toBe(true)
    expect(label.endsWith('…')).toBe(true)
    expect(label.length).toBeLessThanOrEqual(40)
  })

  it('falls back to the quote, then the anchor', () => {
    const quoted = ann('x', 'root')
    quoted.transcript = ''
    quoted.sourceQuote = 'Workload Identity Federation'
    expect(annotationLabel(quoted)).toBe('Workload Identity Federation')

    const bare = ann('y', null)
    bare.transcript = '   '
    expect(annotationLabel(bare)).toBe('What is tokenization?')
  })

  it('collapses whitespace so a crumb never wraps on stray newlines', () => {
    const a = ann('x', 'root')
    a.transcript = 'what   is\n\ntokenization'
    expect(annotationLabel(a)).toBe('what is tokenization')
  })
})
