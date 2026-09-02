import { describe, it, expect } from 'vitest'
import { computeVisibleAnnotationIds } from '@/components/Annotations/AnnotationPanel'
import type { Annotation } from '@/lib/annotations/types'

// Pure-logic coverage for the parent/child visibility guard (per the
// AnnotationPanel hidden-filter spec: "a parent must not be hidden while a
// visible child remains"). No jsdom/rendering needed — see
// annotationPanel.hidden.test.tsx for the end-to-end render coverage.

function makeAnnotation(overrides: Partial<Annotation> & { id: string }): Annotation {
  return {
    documentId: 'doc-1',
    locationGroupKey: 'doc-1:0:10',
    type: 'ask',
    status: 'resolved',
    transcript: 't',
    anchor: { from: 0, to: 10, scope: 'phrase', text: 'x' },
    resolution: null,
    conversation: [],
    parentId: null,
    childIds: [],
    createdAt: 0,
    resolvedAt: null,
    verbosity: 'normal',
    ...overrides,
  }
}

describe('computeVisibleAnnotationIds', () => {
  it('a hidden annotation is excluded when showResolved is off', () => {
    const a = makeAnnotation({ id: 'a', status: 'applied', hidden: true })
    const visible = computeVisibleAnnotationIds([a], false)
    expect(visible.has('a')).toBe(false)
  })

  it('a hidden annotation with hidden === undefined (pre-upgrade snapshot) is treated as visible', () => {
    const a = makeAnnotation({ id: 'a', status: 'applied' }) // hidden left undefined on purpose
    const visible = computeVisibleAnnotationIds([a], false)
    expect(visible.has('a')).toBe(true)
  })

  it('a hidden annotation with hidden === false is visible', () => {
    const a = makeAnnotation({ id: 'a', status: 'applied', hidden: false })
    expect(computeVisibleAnnotationIds([a], false).has('a')).toBe(true)
  })

  it('showResolved reveals every hidden annotation', () => {
    const a = makeAnnotation({ id: 'a', status: 'applied', hidden: true })
    const b = makeAnnotation({ id: 'b', status: 'dismissed', hidden: true })
    const visible = computeVisibleAnnotationIds([a, b], true)
    expect(visible.has('a')).toBe(true)
    expect(visible.has('b')).toBe(true)
  })

  it('a hidden parent with a visible (non-hidden) child stays visible — never orphan the child', () => {
    const parent = makeAnnotation({ id: 'parent', status: 'applied', hidden: true })
    const child = makeAnnotation({ id: 'child', status: 'resolved', parentId: 'parent' }) // resolved: never hideable
    const visible = computeVisibleAnnotationIds([parent, child], false)
    expect(visible.has('parent')).toBe(true)
    expect(visible.has('child')).toBe(true)
  })

  it('a hidden parent with only hidden children is fully excluded', () => {
    const parent = makeAnnotation({ id: 'parent', status: 'applied', hidden: true })
    const child = makeAnnotation({ id: 'child', status: 'dismissed', hidden: true, parentId: 'parent' })
    const visible = computeVisibleAnnotationIds([parent, child], false)
    expect(visible.has('parent')).toBe(false)
    expect(visible.has('child')).toBe(false)
  })

  it('a hidden grandparent with a visible grandchild stays visible through the whole chain', () => {
    const grandparent = makeAnnotation({ id: 'gp', status: 'applied', hidden: true })
    const parent = makeAnnotation({ id: 'p', status: 'dismissed', hidden: true, parentId: 'gp' })
    const grandchild = makeAnnotation({ id: 'gc', status: 'resolved', parentId: 'p' })
    const visible = computeVisibleAnnotationIds([grandparent, parent, grandchild], false)
    expect(visible.has('gp')).toBe(true)
    expect(visible.has('p')).toBe(true)
    expect(visible.has('gc')).toBe(true)
  })

  it('does not infinite-loop on a parentId cycle', () => {
    const a = makeAnnotation({ id: 'a', status: 'applied', hidden: true, parentId: 'b' })
    const b = makeAnnotation({ id: 'b', status: 'applied', hidden: true, parentId: 'a' })
    expect(() => computeVisibleAnnotationIds([a, b], false)).not.toThrow()
  })
})
