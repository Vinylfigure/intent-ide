import type { AnnotationStatus } from './types'

// Valid state transitions
const TRANSITIONS: Record<AnnotationStatus, AnnotationStatus[]> = {
  pending: ['classified'],
  classified: ['resolving'],
  resolving: ['resolved'],
  resolved: ['applied', 'dismissed', 'resolving'], // resolving again = deeper exploration
  applied: [],
  dismissed: [],
}

export function canTransition(from: AnnotationStatus, to: AnnotationStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}
