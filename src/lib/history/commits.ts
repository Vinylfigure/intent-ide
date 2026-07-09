/**
 * Client-side document version layer (git model, accessible language).
 *
 * Every version is a two-level content-addressed snapshot in an append-only
 * linear chain: `contentHash` covers the document content only (the "tree"),
 * `hash` — the primary key — covers content PLUS attribution (parent, kind,
 * message, actor, annotationId, auditIds, modelVersion), so versions that
 * share content but differ in provenance stay distinct records.
 *
 * createCommit fetches the current head, hashes the candidate against it,
 * and POSTs to /api/history (which re-verifies both hashes and enforces
 * linearity — one root, one child per parent). On a stale-head conflict it
 * refetches the head and retries exactly once.
 *
 * Restoring an old version NEVER rewrites history — it (0) flushes any
 * pending edits as a 'direct' version, (1) writes the Article 14 oversight
 * record, (2) appends a 'restore' version linked to that record, and (3)
 * only then mutates the editor. A failure before (3) leaves the document
 * untouched.
 *
 * UI capture points go through `recordCommit`, a fire-and-forget wrapper
 * that can never block or throw into UI paths.
 */

import type { EditorView } from 'prosemirror-view'
import { Node } from 'prosemirror-model'
import { computeCommitHash, computeContentHash } from './canonical'
import { logAuditEvent } from '@/lib/audit/auditLogger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommitKind = 'import' | 'apply' | 'direct' | 'restore'

export interface CommitMeta {
  hash: string
  contentHash: string
  documentId: string
  parentHash: string | null
  kind: CommitKind
  message: string
  blockIdsTouched: string // JSON string[]
  annotationId: string | null
  auditIds: string // JSON string[]
  actor: string
  modelVersion: string
  createdAt: string
}

export interface CommitWithDoc extends CommitMeta {
  docJson: string
}

export interface CreateCommitParams {
  docJson: unknown
  documentId: string
  kind: CommitKind
  message: string
  annotationId?: string | null
  auditIds?: string[]
  blockIdsTouched?: string[]
  actor?: string
  modelVersion?: string
}

export interface CreateCommitResult {
  hash: string
  /** True when nothing was written because the head already has this content. */
  noop: boolean
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ListCommitsOptions {
  limit?: number
  /** ISO createdAt cursor: return only versions strictly older than this. */
  before?: string
}

/** Version metadata for a document, newest first (no content). */
export async function listCommits(
  documentId: string,
  options?: ListCommitsOptions,
): Promise<CommitMeta[]> {
  const params = new URLSearchParams({ documentId })
  if (options?.limit != null) params.set('limit', String(options.limit))
  if (options?.before) params.set('before', options.before)
  const res = await fetch(`/api/history?${params.toString()}`)
  if (!res.ok) throw new Error(`Failed to load history (HTTP ${res.status})`)
  const data = await res.json()
  return data.commits ?? []
}

/** One version including its full document content. */
export async function getCommit(hash: string): Promise<CommitWithDoc | null> {
  const res = await fetch(`/api/history?hash=${encodeURIComponent(hash)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Failed to load version (HTTP ${res.status})`)
  const data = await res.json()
  return data.commit ?? null
}

/** The newest version of a document, or null when it has no history yet. */
export async function headCommit(documentId: string): Promise<CommitMeta | null> {
  const res = await fetch(
    `/api/history?documentId=${encodeURIComponent(documentId)}&limit=1`,
  )
  if (!res.ok) throw new Error(`Failed to load history head (HTTP ${res.status})`)
  const data = await res.json()
  return data.commits?.[0] ?? null
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function toDocJsonString(docJson: unknown): string {
  return typeof docJson === 'string' ? docJson : JSON.stringify(docJson)
}

/** Sentinel: the server rejected the write because the head moved under us. */
const STALE_HEAD = Symbol('stale-head')

async function attemptCommit(
  params: CreateCommitParams,
  docJsonString: string,
  contentHash: string,
): Promise<CreateCommitResult | typeof STALE_HEAD> {
  const head = await headCommit(params.documentId)

  // Content dedupe (tree-level): 'direct' autosave flushes and 'restore'
  // no-op when the head already has this exact content. 'apply' and 'import'
  // ALWAYS commit — their provenance (actor, auditIds, annotation) matters
  // even when the content coincides with the head.
  if (
    head &&
    head.contentHash === contentHash &&
    (params.kind === 'direct' || params.kind === 'restore')
  ) {
    return { hash: head.hash, noop: true }
  }

  const parentHash = head?.hash ?? null
  const annotationId = params.annotationId ?? null
  const auditIds = params.auditIds ?? []
  const actor = params.actor ?? 'human'
  const modelVersion = params.modelVersion ?? ''

  const hash = await computeCommitHash({
    documentId: params.documentId,
    parentHash,
    contentHash,
    kind: params.kind,
    message: params.message,
    actor,
    annotationId,
    auditIds,
    modelVersion,
  })

  const res = await fetch('/api/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'commit',
      hash,
      contentHash,
      documentId: params.documentId,
      parentHash,
      kind: params.kind,
      message: params.message,
      docJson: docJsonString,
      blockIdsTouched: JSON.stringify(params.blockIdsTouched ?? []),
      annotationId: annotationId ?? undefined,
      auditIds: JSON.stringify(auditIds),
      actor,
      modelVersion,
    }),
  })

  if (res.status === 409) {
    const data = await res.json().catch(() => null)
    if (data?.reason === 'stale-head') return STALE_HEAD
    throw new Error(data?.error ?? 'Failed to save version (HTTP 409)')
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error ?? `Failed to save version (HTTP ${res.status})`)
  }
  const data = await res.json()
  return { hash: data.hash ?? hash, noop: false }
}

/**
 * Append a new version. Chains onto the current head; on a stale-head
 * conflict (the server saw another child arrive first) the head is refetched
 * and the write retried exactly once, then gives up with an error.
 */
export async function createCommit(params: CreateCommitParams): Promise<CreateCommitResult> {
  const docJsonString = toDocJsonString(params.docJson)
  const contentHash = await computeContentHash(docJsonString)

  const first = await attemptCommit(params, docJsonString, contentHash)
  if (first !== STALE_HEAD) return first

  // The head advanced between our read and our write (e.g. an 'apply' and an
  // autosave racing). Refetch, rehash against the new head, retry ONCE.
  const second = await attemptCommit(params, docJsonString, contentHash)
  if (second !== STALE_HEAD) return second

  throw new Error('Failed to save version: the document history is advancing concurrently')
}

/**
 * Fire-and-forget version capture for UI paths: never throws, never blocks.
 * Server-side renders and non-browser test environments are a silent no-op.
 */
export function recordCommit(params: CreateCommitParams): void {
  if (typeof window === 'undefined') return
  createCommit(params).catch((err) => {
    console.warn('[history] Failed to record version:', err)
  })
}

// ---------------------------------------------------------------------------
// Blame + restore
// ---------------------------------------------------------------------------

/**
 * "Last changed by" for a block: newest-first scan of each version's
 * blockIdsTouched. `commits` is expected newest first (as listCommits
 * returns); defensively re-sorted by createdAt.
 */
export function blameBlock(commits: CommitMeta[], blockId: string): CommitMeta | null {
  const newestFirst = [...commits].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
  for (const commit of newestFirst) {
    try {
      const touched: unknown = JSON.parse(commit.blockIdsTouched || '[]')
      if (Array.isArray(touched) && touched.includes(blockId)) return commit
    } catch {
      // Malformed metadata never breaks blame — skip the record.
    }
  }
  return null
}

export interface RestoreResult {
  hash: string
  /** True when the document was already at this content — nothing was written. */
  noop: boolean
}

/**
 * Restore an old version (git-checkout semantics, append-only). Persistence
 * comes FIRST; the editor is only mutated after every record is safely
 * written, so a failed write leaves the document exactly as it was and the
 * UI's "Restore failed" message is true:
 *
 *   0. Flush any pending, unsaved editor content as a 'direct' version
 *      (a free no-op when unchanged) — restoring seconds after typing must
 *      not discard the typed tail from history.
 *   1. Log the EU AI Act Article 14 human-oversight record and CAPTURE its
 *      id: a restore is an explicit human decision about document content.
 *   2. Record the NEW 'restore' version — parent = pre-restore head,
 *      auditIds = [the oversight record], a real Article 12 link.
 *   3. Only on success, replace the editor content with the old snapshot —
 *      outside undo history, so Cmd-Z cannot half-revert a restore.
 *
 * Restoring to content identical to the head is a no-op: no version, no
 * audit record, `{ noop: true }` so the UI can say "Already at this version".
 *
 * Must only be invoked from behind a Confirmation gate.
 */
export async function restoreCommit(
  view: EditorView,
  commit: CommitWithDoc,
  documentId: string,
): Promise<RestoreResult> {
  // (0) Flush pending edits so they exist in history before we move off them.
  await createCommit({
    docJson: view.state.doc.toJSON(),
    documentId,
    kind: 'direct',
    message: 'Edited document',
    actor: 'human',
  })

  // Already at this content? Then there is nothing to restore.
  const targetContentHash = await computeContentHash(commit.docJson)
  const head = await headCommit(documentId)
  if (head && head.contentHash === targetContentHash) {
    return { hash: head.hash, noop: true }
  }

  const shortHash = commit.hash.slice(0, 8)

  // (1) Article 14 oversight record, id captured for the version linkage.
  // logAuditEvent is designed never to throw; a failed audit write yields
  // null and the restore version then records zero audit ids (surfaced
  // honestly in docs/compliance.md).
  const auditId = await logAuditEvent({
    userId: 'local',
    modelName: 'human',
    modelVersion: 'human',
    promptVersion: 'N/A',
    promptHash: 'N/A',
    queryClassification: 'HUMAN_RESTORE',
    sourceDocuments: JSON.stringify([documentId]),
    confidenceScore: null,
    responseId: crypto.randomUUID(),
    outputType: 'HUMAN_RESTORE',
    approvalStatus: 'APPROVED_HUMAN',
    overrideReason: `Restored version ${shortHash}`,
  })

  // (2) The restore version, linked to the oversight record. Throws on
  // failure — and the editor has not been touched yet.
  const { hash: newHash } = await createCommit({
    docJson: commit.docJson,
    documentId,
    kind: 'restore',
    message: `Restored version ${shortHash}`,
    actor: 'human',
    auditIds: auditId ? [auditId] : [],
  })

  // (3) Persistence succeeded — now, and only now, mutate the editor.
  const restoredDoc = Node.fromJSON(view.state.schema, JSON.parse(commit.docJson))
  const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, restoredDoc.content)
  tr.setMeta('addToHistory', false)
  view.dispatch(tr)

  return { hash: newHash, noop: false }
}
