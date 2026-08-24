import { describe, expect, it } from 'vitest'
import { clusterMarkers, type MapMarker } from '../clusterMarkers'

function marker(id: string, position: number, type: MapMarker['type'] = 'ask'): MapMarker {
  return { id, type, position, label: id, isActive: false }
}

describe('clusterMarkers', () => {
  it('keeps well-separated markers as singleton clusters', () => {
    const input = [marker('a', 0.1), marker('b', 0.4), marker('c', 0.9)]
    const clusters = clusterMarkers(input)
    expect(clusters).toHaveLength(3)
    expect(clusters.every((c) => c.members.length === 1)).toBe(true)
    expect(clusters.map((c) => c.members[0].id)).toEqual(['a', 'b', 'c'])
  })

  it('merges markers at the exact same position into one cluster', () => {
    const input = [marker('a', 0.25), marker('b', 0.25)]
    const clusters = clusterMarkers(input)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].members.map((m) => m.id).sort()).toEqual(['a', 'b'])
    expect(clusters[0].position).toBeCloseTo(0.25)
  })

  it('merges markers within the gap threshold and splits beyond it', () => {
    const input = [marker('a', 0.1), marker('b', 0.13), marker('c', 0.2)]
    const clusters = clusterMarkers(input, 0.05)
    expect(clusters).toHaveLength(2)
    expect(clusters[0].members.map((m) => m.id)).toEqual(['a', 'b'])
    expect(clusters[1].members.map((m) => m.id)).toEqual(['c'])
  })

  it('preserves every marker: cluster sizes always sum to the input count', () => {
    const input = [
      marker('a', 0.02),
      marker('b', 0.02),
      marker('c', 0.05),
      marker('d', 0.3),
      marker('e', 0.31, 'edit'),
      marker('f', 0.72, 'flag'),
      marker('g', 0.99, 'dig'),
    ]
    const clusters = clusterMarkers(input)
    const total = clusters.reduce((sum, c) => sum + c.members.length, 0)
    expect(total).toBe(input.length)
    const ids = clusters.flatMap((c) => c.members.map((m) => m.id)).sort()
    expect(ids).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
  })

  it('returns no clusters for no markers', () => {
    expect(clusterMarkers([])).toEqual([])
  })
})
