import type {
  CascadeEdgeType,
  CascadeEvidence,
  CascadeSeverity,
  ProposedEditRelation,
  ProposedEditStatus,
} from '@/lib/annotations/types'
import { useCascadeCalibrationStore } from '@/stores/cascadeCalibrationStore'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * Severity-calibration telemetry for cascade review decisions — METADATA ONLY.
 *
 * Every event is exactly { severity, edgeType, relation, action, source }:
 * closed enum values, no document text, no annotation/edit/document ids, no
 * free-form strings. Two sinks:
 *
 * 1. ALWAYS: the local persisted aggregate (cascadeCalibrationStore) that
 *    powers the settings readout. Never leaves the machine.
 * 2. ONLY when the `telemetryEnabled` setting is true (default FALSE — this is
 *    a public repo and other people run this app): a PostHog capture. No
 *    PostHog client is wired into the app today, so the capture is a
 *    clearly-marked stub calling `window.posthog?.capture` — it becomes live
 *    the moment a user initializes posthog-js themselves, and is a silent
 *    no-op until then.
 *
 * Recording is fire-and-forget: every entry point swallows all errors so
 * telemetry can never block or break a review flow.
 */

export interface CascadeDecisionEvent {
  severity: CascadeSeverity
  /** Evidence edge type when the proposal was cited, else null. */
  edgeType: CascadeEdgeType | null
  relation: ProposedEditRelation
  action: 'accepted' | 'rejected' | 'applied'
  source: 'inline' | 'list' | 'modal'
}

/** Remote-sink payload — the event minus nothing, plus nothing. */
type CapturePayload = Pick<
  CascadeDecisionEvent,
  'severity' | 'edgeType' | 'relation' | 'action' | 'source'
>

export type CaptureFn = (eventName: string, payload: CapturePayload) => void

export const CASCADE_CALIBRATION_EVENT = 'cascade_calibration_decision'

/**
 * PostHog capture STUB: no posthog client is initialized anywhere in this app
 * (grep: no posthog imports exist). If a user wires posthog-js up themselves,
 * `window.posthog` exists and this starts capturing; otherwise it is a no-op.
 */
const defaultCapture: CaptureFn = (eventName, payload) => {
  if (typeof window === 'undefined') return
  const w = window as {
    posthog?: { capture?: (name: string, props: Record<string, unknown>) => void }
  }
  w.posthog?.capture?.(eventName, { ...payload })
}

/** Test/caller injection points; production call sites pass nothing. */
export interface RecordDeps {
  capture?: CaptureFn
  /** Override for the settings-store telemetryEnabled flag. */
  telemetryEnabled?: boolean
}

/**
 * Record one cascade review decision. Only `relation === 'cascade'` events
 * carry calibration signal (primary edits are what the user explicitly asked
 * for — accepting them says nothing about derived severities), so anything
 * else is dropped. Never throws.
 */
export function recordCascadeDecision(event: CascadeDecisionEvent, deps: RecordDeps = {}): void {
  try {
    if (event.relation !== 'cascade') return

    // Sink 1 (always): local aggregate for the settings readout.
    useCascadeCalibrationStore.getState().record(event.severity, event.action)

    // Sink 2 (opt-in, default off): anonymous remote capture.
    const enabled = deps.telemetryEnabled ?? useSettingsStore.getState().telemetryEnabled
    if (!enabled) return
    const payload: CapturePayload = {
      severity: event.severity,
      edgeType: event.edgeType,
      relation: event.relation,
      action: event.action,
      source: event.source,
    }
    ;(deps.capture ?? defaultCapture)(CASCADE_CALIBRATION_EVENT, payload)
  } catch {
    // Telemetry must never block a review flow.
  }
}

/** The slice of a ProposedEdit / ProposedAnchor the guard needs. */
export interface ReviewedEditLike {
  relation: ProposedEditRelation
  severity: CascadeSeverity
  evidence: CascadeEvidence | null
  status: ProposedEditStatus
}

/**
 * Status-change guard shared by every accept/reject surface: records ONLY
 * when `next` differs from the edit's CURRENT status (callers pass the live
 * plugin anchor when available), so re-clicking Accept on an already-accepted
 * edit — or the modal echoing a status the plugin already holds — never
 * double-counts. Call BEFORE dispatching setProposedEditStatus.
 */
export function recordCascadeStatusChange(
  edit: ReviewedEditLike,
  next: 'accepted' | 'rejected',
  source: CascadeDecisionEvent['source'],
  deps: RecordDeps = {},
): void {
  try {
    if (edit.status === next) return
    recordCascadeDecision(
      {
        severity: edit.severity,
        edgeType: edit.evidence?.edgeType ?? null,
        relation: edit.relation,
        action: next,
        source,
      },
      deps,
    )
  } catch {
    // Never block the review flow.
  }
}
