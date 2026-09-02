import { describe, it, expect, beforeEach } from 'vitest'
import { useLayoutStore, normalizeCollapsedAnnotationIds } from '../layoutStore'

// Per-card collapse (AnnotationCard's chevron). The collapsed set is a view
// preference persisted in layoutStore (key 'intent-ide-layout'), never
// annotation state — see the doc comment on `collapsedAnnotationIds`.

beforeEach(() => {
  useLayoutStore.setState({ collapsedAnnotationIds: [] })
})

describe('layoutStore — collapsedAnnotationIds', () => {
  it('defaults to no collapsed cards', () => {
    expect(useLayoutStore.getState().collapsedAnnotationIds).toEqual([])
  })

  it('toggleAnnotationCollapsed collapses then expands a card', () => {
    useLayoutStore.getState().toggleAnnotationCollapsed('ann-1')
    expect(useLayoutStore.getState().collapsedAnnotationIds).toEqual(['ann-1'])
    useLayoutStore.getState().toggleAnnotationCollapsed('ann-1')
    expect(useLayoutStore.getState().collapsedAnnotationIds).toEqual([])
  })

  it('tracks multiple collapsed cards independently', () => {
    useLayoutStore.getState().toggleAnnotationCollapsed('ann-1')
    useLayoutStore.getState().toggleAnnotationCollapsed('ann-2')
    expect(useLayoutStore.getState().collapsedAnnotationIds.sort()).toEqual(['ann-1', 'ann-2'])
    useLayoutStore.getState().toggleAnnotationCollapsed('ann-1')
    expect(useLayoutStore.getState().collapsedAnnotationIds).toEqual(['ann-2'])
  })

  it('setAnnotationCollapsed sets an explicit state idempotently', () => {
    useLayoutStore.getState().setAnnotationCollapsed('ann-1', true)
    useLayoutStore.getState().setAnnotationCollapsed('ann-1', true) // no duplicate
    expect(useLayoutStore.getState().collapsedAnnotationIds).toEqual(['ann-1'])
    useLayoutStore.getState().setAnnotationCollapsed('ann-1', false)
    expect(useLayoutStore.getState().collapsedAnnotationIds).toEqual([])
    useLayoutStore.getState().setAnnotationCollapsed('ann-1', false) // no-op, already absent
    expect(useLayoutStore.getState().collapsedAnnotationIds).toEqual([])
  })
})

// This is the same pattern the existing layoutStore.test.ts uses for
// normalizeAnswerPlacement/clampSidebarWidth: onRehydrateStorage calls this
// function directly on whatever localStorage handed back, so testing it in
// isolation proves collapse state survives a rehydrate (a real
// getItem/setItem round trip needs a browser localStorage this suite's node
// environment doesn't have — see vitest.config.ts).
describe('normalizeCollapsedAnnotationIds', () => {
  it('passes through a persisted array of ids unchanged', () => {
    expect(normalizeCollapsedAnnotationIds(['ann-1', 'ann-2'])).toEqual(['ann-1', 'ann-2'])
  })

  it('falls back to an empty array for a snapshot from before this field existed', () => {
    expect(normalizeCollapsedAnnotationIds(undefined)).toEqual([])
  })

  it('falls back to an empty array for corrupt/non-array values', () => {
    expect(normalizeCollapsedAnnotationIds(null)).toEqual([])
    expect(normalizeCollapsedAnnotationIds('ann-1')).toEqual([])
    expect(normalizeCollapsedAnnotationIds(42)).toEqual([])
  })

  it('drops non-string entries from an otherwise-valid array', () => {
    expect(normalizeCollapsedAnnotationIds(['ann-1', 42, null, 'ann-2'])).toEqual(['ann-1', 'ann-2'])
  })
})
