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

/**
 * A terminal status has no legal outgoing transition — only `applied` and
 * `dismissed` today. Used to gate hiding a card (Annotation.hidden): a
 * `resolved` annotation still has actions the user hasn't taken, so it must
 * never be hidden even though it isn't "pending" in the everyday sense.
 */
export function isTerminalStatus(status: AnnotationStatus): boolean {
  return (TRANSITIONS[status]?.length ?? 0) === 0
}
