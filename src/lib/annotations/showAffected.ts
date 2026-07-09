import type { Annotation } from './types'

/**
 * Branch decision for the "Show affected" action.
 *
 * 'scroll'   — scroll to + pulse the CascadeList. Only valid while the list is
 *              actually rendered: CascadeList mounts ONLY for status
 *              'resolved' annotations with cascade edits, so anything else
 *              (applied, dismissed, no cascades) would scroll to nothing —
 *              a dead button.
 * 'followup' — ask the agent for dependent locations as a conversation
 *              message (always produces visible output).
 */
export function showAffectedMode(annotation: Annotation): 'scroll' | 'followup' {
  const hasCascadeEdits = (annotation.resolution?.edits ?? []).some(
    (e) => e.relation === 'cascade',
  )
  return annotation.status === 'resolved' && hasCascadeEdits ? 'scroll' : 'followup'
}
