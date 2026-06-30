import { describe, it, expect } from 'vitest'
import { groupByTime } from '../grouping'
import type { ChangeEntry } from '../changeLog'

function makeEntry(overrides: Partial<ChangeEntry> = {}): ChangeEntry {
  return {
    id: 'test-id',
    documentId: 'doc-1',
    rootAnnotationId: null,
    annotationId: null,
    timestamp: Date.now(),
    description: 'test change',
    beforeSlice: 'before',
    afterSlice: 'after',
    from: 0,
    to: 10,
    pmStep: null,
    undone: false,
    ...overrides,
  }
}

describe('groupByTime', () => {
  it('returns empty array for empty input', () => {
    expect(groupByTime([])).toEqual([])
  })

  it('groups recent entries as "Just now"', () => {
    const entries = [
      makeEntry({ id: '1', timestamp: Date.now() - 1000 }),
      makeEntry({ id: '2', timestamp: Date.now() - 2000 }),
    ]
    const groups = groupByTime(entries)
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Just now')
    expect(groups[0].entries).toHaveLength(2)
  })

  it('groups entries from 5-60 min ago as "Last hour"', () => {
    const entries = [
      makeEntry({ id: '1', timestamp: Date.now() - 10 * 60 * 1000 }),
    ]
    const groups = groupByTime(entries)
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Last hour')
  })

  it('groups entries from >60 min ago as "Earlier"', () => {
    const entries = [
      makeEntry({ id: '1', timestamp: Date.now() - 2 * 60 * 60 * 1000 }),
    ]
    const groups = groupByTime(entries)
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Earlier')
  })

  it('creates multiple groups for mixed timestamps', () => {
    const entries = [
      makeEntry({ id: '1', timestamp: Date.now() - 1000 }),
      makeEntry({ id: '2', timestamp: Date.now() - 30 * 60 * 1000 }),
      makeEntry({ id: '3', timestamp: Date.now() - 3 * 60 * 60 * 1000 }),
    ]
    const groups = groupByTime(entries)
    expect(groups).toHaveLength(3)
    expect(groups.map((g) => g.label)).toEqual(['Just now', 'Last hour', 'Earlier'])
  })

  it('omits empty groups', () => {
    const entries = [
      makeEntry({ id: '1', timestamp: Date.now() - 1000 }),
      makeEntry({ id: '2', timestamp: Date.now() - 3 * 60 * 60 * 1000 }),
    ]
    const groups = groupByTime(entries)
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.label)).toEqual(['Just now', 'Earlier'])
  })
})
