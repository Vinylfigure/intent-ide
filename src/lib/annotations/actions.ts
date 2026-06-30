import type { AnnotationType, ResolutionAction } from './types'

export const ACTIONS_BY_TYPE: Record<AnnotationType, ResolutionAction[]> = {
  ask: [
    { label: 'Got it', kind: 'accept', handler: 'dismiss' },
    { label: 'Go deeper', kind: 'deepen', handler: 'explore' },
    { label: 'Change based on this', kind: 'apply', handler: 'change-from-answer' },
  ],
  edit: [
    { label: 'Apply', kind: 'apply', handler: 'apply-edit' },
    { label: 'Tweak it', kind: 'deepen', handler: 'tweak' },
    { label: 'Show affected', kind: 'deepen', handler: 'show-cascade' },
    { label: 'Nevermind', kind: 'dismiss', handler: 'dismiss' },
  ],
  dig: [
    { label: 'Got it', kind: 'accept', handler: 'dismiss' },
    { label: 'Add to doc', kind: 'apply', handler: 'add-to-doc' },
    { label: 'Keep digging', kind: 'deepen', handler: 'explore-deeper' },
  ],
  flag: [
    { label: 'Keep it', kind: 'accept', handler: 'park' },
    { label: 'Act on this', kind: 'apply', handler: 'act-on-thought' },
    { label: 'Research more', kind: 'deepen', handler: 'research' },
    { label: 'Dismiss', kind: 'dismiss', handler: 'dismiss' },
  ],
}
