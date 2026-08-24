import type { AnnotationType } from './types'

export interface MapMarker {
  id: string
  type: AnnotationType
  /** Document position as a fraction of doc length, 0..1. */
  position: number
  label: string
  isActive: boolean
}

export interface MarkerCluster {
  /** Mean position of the members, 0..1 — where the cluster dot renders. */
  position: number
  /** Document order (ascending position). Never empty. */
  members: MapMarker[]
}

/**
 * Group markers whose positions fall within `minGapFraction` of the first
 * marker in the group (single-pass over markers sorted by position), so
 * markers that would render at overlapping pixels become one cluster with a
 * count badge instead of occluding each other.
 *
 * Invariant: every input marker appears in exactly one cluster — the sum of
 * cluster sizes always equals the input count.
 */
export function clusterMarkers(markers: MapMarker[], minGapFraction = 0.05): MarkerCluster[] {
  if (markers.length === 0) return []

  const sorted = [...markers].sort((a, b) => a.position - b.position)
  const clusters: MarkerCluster[] = []
  let members: MapMarker[] = [sorted[0]]
  let anchor = sorted[0].position

  const flush = () => {
    const mean = members.reduce((sum, m) => sum + m.position, 0) / members.length
    clusters.push({ position: mean, members })
  }

  for (let i = 1; i < sorted.length; i++) {
    const marker = sorted[i]
    if (marker.position - anchor <= minGapFraction) {
      members.push(marker)
    } else {
      flush()
      members = [marker]
      anchor = marker.position
    }
  }
  flush()

  return clusters
}
