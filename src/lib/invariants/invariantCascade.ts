import type { EditorState } from 'prosemirror-state'
import { findBlockById } from '@/lib/prosemirror/blockIds'
import { primaryProposedEdit } from '@/lib/ai/orchestrator'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useChangesStore } from '@/stores/changesStore'
import { useDocumentStore } from '@/stores/documentStore'
import { useToastStore } from '@/stores/toastStore'
import { useInvariantFlagStore } from '@/stores/invariantFlagStore'
import { generateId } from '@/lib/utils/id'
import { listInvariants, resolveInvariant, type Invariant, type ListInvariantsCursor } from './captureInvariant'
import { checkInvariants, type InvariantViolation } from './invariantCheckRunner'
import { checkEntailmentInvariants, type EntailmentCheckDeps } from './entailmentCheck'
import { useSettingsStore } from '@/stores/settingsStore'
import type { Annotation, CascadeEvidence, ProposedEdit, ResolutionAction } from '@/lib/annotations/types'

/**
 * Document Invariant Ledger — Phase 2 (issue #32): surfaces a failing
 * deterministic check through the existing single CascadeList surface,
 * exactly as the Flow v1 direct-edit trigger (`directEditCascade.ts`) does.
 * No new UI path — the "one cascade surface" rule (Wave D2) holds.
 *
 * HITL: doc-CI flags, it never edits. The primary anchor is pre-marked
 * 'rejected' (nothing to apply — it just anchors "why this proposal?" at the
 * block that declared the fact) and the cascade edit is a no-op
 * (targetText === newText), so accepting the flag can never mutate the
 * document; it only marks the flag reviewed.
 */

const FLAG_ACTIONS: ResolutionAction[] = [
  { label: 'Show affected', kind: 'deepen', handler: 'show-cascade' },
  { label: 'Nevermind', kind: 'dismiss', handler: 'dismiss' },
]

// Shared with `invariantIdFromFlagKey` below — the one source of truth for
// this key's shape, so construction and parsing can't drift apart.
const INVARIANT_KEY_MARKER = 'invariant'

/** Deterministic key for one (invariant, conflicting block) pair — the dedup unit. */
function violationKey(documentId: string, violation: InvariantViolation): string {
  return `${documentId}:${INVARIANT_KEY_MARKER}:${violation.invariantId}:${violation.conflictBlockId}`
}

/**
 * Recovers the invariantId from a `locationGroupKey` produced by
 * `violationKey` above (an invariant-check flag's `Annotation.locationGroupKey`
 * IS that key verbatim), or null for any other annotation. Used by
 * `resolveInvariantFlagOnDismiss` below to detect "this is an invariant-check
 * flag" without adding a new field to the general-purpose `Annotation` type.
 *
 * Anchored from the END of the string (the last 3 ':'-separated segments must
 * be [marker, invariantId, conflictBlockId]) rather than searching for the
 * marker from the front. `invariantId` (a Prisma cuid) and `conflictBlockId`
 * (a ProseMirror block id) never contain colons by construction, but
 * `documentId` is not similarly constrained here — an indexOf-from-the-front
 * search would misparse a documentId that happens to contain the literal
 * substring "invariant" bracketed by colons.
 */
export function invariantIdFromFlagKey(locationGroupKey: string): string | null {
  const parts = locationGroupKey.split(':')
  if (parts.length < 4) return null
  const [invariantId, conflictBlockId] = parts.slice(-2)
  if (parts[parts.length - 3] !== INVARIANT_KEY_MARKER) return null
  return invariantId && conflictBlockId ? invariantId : null
}

/**
 * Whole-word verification that `numberToken` literally appears in the given
 * block's text — the same word-boundary discipline `containsTerm` applies to
 * subject terms, applied here to the citation itself. A bare contiguity
 * check (as `blockTextRange` does, by design, for arbitrary quoted phrases)
 * would let a short token like "30" spuriously "verify" against "2030" or
 * "$3,000" — a coincidental substring, not a real citation.
 */
function verifiesInBlock(blockText: string, numberToken: string): boolean {
  const idx = blockText.indexOf(numberToken)
  if (idx === -1) return false
  const before = idx > 0 ? blockText[idx - 1] : ' '
  const after = idx + numberToken.length < blockText.length ? blockText[idx + numberToken.length] : ' '
  return /\W/.test(before) && /\W/.test(after)
}

/**
 * Evidence is only ever set when the declared figure literally, word-
 * boundary-verifies against one of the blocks that declared it — an
 * unverifiable quote must not claim citation integrity (the same rule
 * `orchestrator.ts`'s `buildEvidence` enforces for every other cascade path:
 * "an uncited proposal can never be `must`"). Tries every evidence block, not
 * just the first, so losing one declaring block doesn't sink an otherwise-
 * verifiable citation. When nothing verifies (the exact wording drifted from
 * the source block since capture — the modal lets a user edit the captured
 * text — or the figure was reformatted), this degrades to NO evidence and
 * `'optional'` severity, matching `deriveSeverity`'s own convention
 * elsewhere in the codebase: no locatable citation is a lead, never a must.
 */
function verifiedEvidence(
  doc: EditorState['doc'],
  evidenceBlockIds: string[],
  statementNumber: string,
): { evidence: CascadeEvidence | null; severity: 'must' | 'optional' } {
  for (const sourceBlockId of evidenceBlockIds) {
    const block = findBlockById(doc, sourceBlockId)
    if (block && verifiesInBlock(block.node.textContent, statementNumber)) {
      return {
        evidence: { sourceBlockId, quotedText: statementNumber, edgeType: 'contradicts' },
        severity: 'must',
      }
    }
  }
  return { evidence: null, severity: 'optional' }
}

/**
 * An entailment violation (Phase 4, #51) has no figure to cite — the absence
 * of any exact-match anchor is precisely why it needed a judge rather than the
 * deterministic lane. So it degrades to no evidence and `'optional'` severity,
 * under the same rule that governs every other cascade path in this codebase:
 * an uncited proposal can never be `must`. A model's say-so is a lead.
 */
function violationEvidence(
  doc: EditorState['doc'],
  violation: InvariantViolation,
): { evidence: CascadeEvidence | null; severity: 'must' | 'optional' } {
  if (violation.checkKind !== 'deterministic') return { evidence: null, severity: 'optional' }
  return verifiedEvidence(doc, violation.evidenceBlockIds, violation.statementNumber)
}

function violationReason(violation: InvariantViolation): string {
  return violation.checkKind === 'deterministic'
    ? `Declared "${violation.statementNumber}", but this section says "${violation.conflictNumber}": "${violation.statement}"`
    : `Declared "${violation.statement}", but this section may contradict it: ${violation.judgeReason}`
}

function conflictEdit(doc: EditorState['doc'], violation: InvariantViolation): ProposedEdit | null {
  const block = findBlockById(doc, violation.conflictBlockId)
  if (!block) return null
  const from = block.pos + 1
  const to = block.pos + block.node.nodeSize - 1
  const text = block.node.textContent
  const { evidence, severity } = violationEvidence(doc, violation)
  return {
    id: generateId(),
    from,
    to,
    newText: text,
    reason: violationReason(violation),
    relation: 'cascade',
    status: 'pending',
    targetText: text,
    blockId: violation.conflictBlockId,
    severity,
    evidence,
  }
}

/** Anchors "why this proposal?" at whichever evidence block still resolves. */
function primaryAnchor(doc: EditorState['doc'], violation: InvariantViolation): ProposedEdit | null {
  for (const blockId of violation.evidenceBlockIds) {
    const block = findBlockById(doc, blockId)
    if (!block) continue
    const from = block.pos + 1
    const to = block.pos + block.node.nodeSize - 1
    const text = block.node.textContent
    return {
      ...primaryProposedEdit(
        { from, to, newText: text, reason: `Declared: "${violation.statement}"` },
        text,
        blockId,
      ),
      status: 'rejected',
    }
  }
  return null
}

// Defensive bound on how many pages `listAllInvariants` will walk. Not a
// real limit in practice: `GET /api/invariants` computes the live set from a
// scan of at most SUPERSEDE_SCAN_CAP (2000) rows regardless of cursor, so at
// the route's own DEFAULT_LIMIT (100) a genuinely-exhaustive walk of that
// scan window never exceeds 20 pages — this only guards against an
// unforeseen cursor bug looping forever.
const MAX_INVARIANT_PAGES = 25

/**
 * Walks every page of a document's live invariants (#59 — the check runner
 * previously read only `GET /api/invariants`'s first page, silently
 * excluding older declared facts once a document passed the route's
 * DEFAULT_LIMIT of 100). Returns `null` if the active document changed
 * during the walk, so the caller can abort exactly as it already does for
 * the single-page case, rather than tagging a flag with the wrong
 * document's id.
 *
 * A `scanTruncated` page means the route's own scan window was cut off
 * before reaching the end of this document's raw rows — this is a
 * pre-existing, disclosed limit of the route itself (see its doc-comment),
 * not something a caller can page around, so it is only logged here, not
 * treated as an error.
 */
async function listAllInvariants(documentId: string): Promise<Invariant[] | null> {
  const invariants: Invariant[] = []
  let cursor: ListInvariantsCursor | undefined
  let scanTruncated = false

  for (let page = 0; page < MAX_INVARIANT_PAGES; page++) {
    const result = await listInvariants(documentId, cursor)
    if (useDocumentStore.getState().activeDocumentId !== documentId) return null

    invariants.push(...result.invariants)
    scanTruncated = scanTruncated || result.scanTruncated
    if (!result.nextCursor || !result.nextCursorId) {
      if (scanTruncated) {
        console.warn(
          `[invariants] Check runner's page walk for document ${documentId} stopped within a truncated scan window — older invariants may be unreachable this run.`,
        )
      }
      return invariants
    }
    cursor = { before: result.nextCursor, beforeId: result.nextCursorId }
  }

  console.warn(
    `[invariants] Check runner hit its ${MAX_INVARIANT_PAGES}-page safety bound for document ${documentId} — stopping early.`,
  )
  return invariants
}

/**
 * Runs the deterministic doc-CI lane for a document against its current
 * editor state and appends one resolved 'flag' annotation per violated
 * invariant. Fire-and-forget: never throws into the caller (a DocCommit
 * write must never be blocked by a check-lane failure).
 *
 * Two guards keep this from becoming an unbounded nuisance:
 * - Doc-switch race: `state` is read from a caller-captured EditorView after
 *   an async round-trip (now potentially several, via `listAllInvariants`);
 *   if the active document changed in the meantime, `state` and
 *   `documentId` would disagree — abort rather than tag a flag with the
 *   wrong document's id (same guard as the sibling `directEditCascade.ts`).
 * - Re-flag dedup: the check re-runs on every apply, so without a dedup an
 *   unresolved conflict would re-surface as a brand-new annotation on every
 *   future apply anywhere in the document, forever. Dedup state lives in its
 *   OWN store (`invariantFlagStore`), not derived from `annotationStore` —
 *   `DocInputModal.loadDoc()` unconditionally clears `annotationStore` on
 *   every new-document creation (a pre-existing, out-of-scope behavior), and
 *   deriving dedup from it would let starting an unrelated document revive
 *   every other document's already-seen flags. `checkInvariants` naturally
 *   stops returning a violation once the conflict is actually fixed, so a
 *   real fix still clears the underlying cause even though the flag record
 *   itself isn't retracted (Phase 1's ledger has no dismiss/resolve route —
 *   a named, disclosed follow-up, not silently assumed away).
 */
export async function runAndSurfaceInvariantChecks(
  documentId: string,
  state: EditorState,
  opts: {
    /** Test/caller override for the settings-store entailment toggle. */
    entailmentEnabled?: boolean
    /** Injectable judge/graph for the entailment lane (tests). */
    entailmentDeps?: EntailmentCheckDeps
  } = {},
): Promise<void> {
  try {
    if (useDocumentStore.getState().activeDocumentId !== documentId) return

    const invariants = await listAllInvariants(documentId)
    if (invariants === null) return // active document changed mid-page-walk

    const violations: InvariantViolation[] = checkInvariants(state.doc, invariants)

    // Entailment lane (Phase 4, #51): opt-in only. Off by default because it
    // is the one doc-CI path that spends money and sends document text — the
    // deterministic lane above stays local and always-on regardless. Runs on
    // this same user-initiated apply, never on typing.
    const entailmentOn =
      opts.entailmentEnabled ?? useSettingsStore.getState().invariantEntailmentEnabled
    if (entailmentOn) {
      const config = useSettingsStore.getState().llmConfig
      // Candidates for this lane are NOT just `checkKind: 'entailment'` rows.
      // `classifyCheckKind` decides the lane from the statement text ALONE —
      // it cannot see the future drift text, so it cannot always predict
      // whether the deterministic lane's exact-word `containsTerm` subject
      // match will actually fire (a plural variant or a reworded date can
      // defeat it even when a figure and a term are both present, which is
      // all `classifyCheckKind` can check). A `'deterministic'`-classified
      // invariant that produced no deterministic violation this run is given
      // a second look here rather than assumed clean. This also covers every
      // ledger row written before this phase shipped, when capture
      // unconditionally defaulted to `checkKind: 'deterministic'` — those
      // rows need no migration to reach this lane; they just need this run
      // to find nothing wrong with them deterministically, which a genuinely
      // stale row won't.
      const flaggedByDeterministic = new Set(violations.map((v) => v.invariantId))
      const entailmentCandidates = invariants.filter((inv) => {
        if (inv.status !== 'active') return false
        if (inv.checkKind === 'entailment') return true
        return inv.checkKind === 'deterministic' && !flaggedByDeterministic.has(inv.id)
      })
      const entailed = await checkEntailmentInvariants(
        state.doc,
        entailmentCandidates,
        config,
        opts.entailmentDeps,
      )
      // The judge call is a second async gap — re-check the doc-switch guard
      // before tagging anything with this documentId.
      if (useDocumentStore.getState().activeDocumentId !== documentId) return
      violations.push(...entailed)
    }

    if (violations.length === 0) return

    const flagStore = useInvariantFlagStore.getState()

    for (const violation of violations) {
      const key = violationKey(documentId, violation)
      if (flagStore.hasSurfaced(key)) continue

      const primary = primaryAnchor(state.doc, violation)
      const cascade = conflictEdit(state.doc, violation)
      // Both anchors must resolve against the live doc, or there is nothing
      // stable to point the flag at (e.g. every declaring block was since
      // deleted) — skip rather than surface a flag anchored to nothing.
      if (!primary || !cascade) continue

      const now = Date.now()
      const annotation: Annotation = {
        id: generateId(),
        documentId,
        locationGroupKey: key,
        type: 'flag',
        status: 'resolved',
        transcript: `Declared fact may no longer hold: "${violation.statement}"`,
        anchor: { from: cascade.from, to: cascade.to, scope: 'paragraph', text: cascade.targetText },
        resolution: {
          type: 'flag',
          content: `A section conflicts with a fact you declared earlier: "${violation.statement}". Review below.`,
          suggestedEdit: null,
          edits: [primary, cascade],
          actions: FLAG_ACTIONS,
        },
        conversation: [],
        parentId: null,
        childIds: [],
        createdAt: now,
        resolvedAt: now,
        verbosity: 'normal',
      }

      useAnnotationStore.getState().add(annotation)
      useChangesStore.getState().ensureChangeSetForAnnotation(annotation)
      flagStore.markSurfaced(key)
      useToastStore.getState().addToast('A declared fact may no longer hold — see Annotations', 'info')
    }
  } catch (err) {
    console.warn('[invariants] Check runner failed:', err)
  }
}

/**
 * Resolves the ledger row behind a dismissed invariant-check flag ("Nevermind",
 * #35) and prunes its dedup entry — but ONLY once the resolve genuinely
 * succeeds. A failed network call leaves the dedup entry in place, so the
 * still-`active` ledger row's dedup memory stays intact (bounded by
 * `invariantFlagStore`'s own `MAX_SURFACED` eviction) instead of letting the
 * next `runAndSurfaceInvariantChecks` pass treat the same conflict as
 * never-seen and append an unbounded new entry to `annotationStore` (which,
 * unlike the flag store, has no cap). No-op — and no network call — for a
 * `locationGroupKey` that isn't an invariant-check flag's.
 */
export async function resolveInvariantFlagOnDismiss(annotation: {
  documentId: string
  locationGroupKey: string
}): Promise<void> {
  const invariantId = invariantIdFromFlagKey(annotation.locationGroupKey)
  if (!invariantId) return
  try {
    await resolveInvariant({ documentId: annotation.documentId, invariantId, status: 'resolved' })
    useInvariantFlagStore.getState().removeSurfaced(annotation.locationGroupKey)
  } catch (err) {
    console.warn('[invariants] Failed to resolve invariant on dismiss:', err)
  }
}
