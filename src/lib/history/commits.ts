/**
 * Client-side document version layer (git model, accessible language).
 *
 * Every version is a content-addressed snapshot in an append-only linear
 * chain: createCommit fetches the current head, hashes the new content
 * against it, and POSTs to /api/history (which re-verifies the hash).
 * Restoring an old version NEVER rewrites history — it dispatches the old
 * content into the editor and records a NEW 'restore' version on top,
 * plus an Article 14 human-oversight audit record.
 *
 * All capture points go through `recordCommit`, a fire-and-forget wrapper
 * that can never block or throw into UI paths.
 */

import type { EditorView } from 'prosemirror-view'
import { Node } from 'prosemirror-model'
import { computeCommitHash } from './canonical'
import { logAuditEvent } from '@/lib/audit/auditLogger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommitKind = 'import' | 'apply' | 'direct' | 'restore'

export interface CommitMeta {
  hash: string
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

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Version metadata for a document, newest first (no content). */
export async function listCommits(documentId: string): Promise<CommitMeta[]> {
  const res = await fetch(`/api/history?documentId=${encodeURIComponent(documentId)}`)
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
// Hashing + writes
// ---------------------------------------------------------------------------

function toDocJsonString(docJson: unknown): string {
  return typeof docJson === 'string' ? docJson : JSON.stringify(docJson)
}

/** Content-address for a candidate version (sha256 hex via crypto.subtle). */
export async function hashCommit(
  docJson: unknown,
  parentHash: string | null,
  documentId: string,
): Promise<string> {
  return computeCommitHash(docJson, parentHash, documentId)
}

/**
 * Append a new version. Chains onto the current head; when the content is
 * identical to the head (hashing the candidate against the head's parent
 * reproduces the head's own hash), this is a no-op that returns the existing
 * head hash — which is what makes idle autosave flushes free.
 */
export async function createCommit(params: CreateCommitParams): Promise<string> {
  const docJsonString = toDocJsonString(params.docJson)
  const head = await headCommit(params.documentId)

  if (head) {
    const unchanged = await hashCommit(docJsonString, head.parentHash, params.documentId)
    if (unchanged === head.hash) return head.hash
  }

  const parentHash = head?.hash ?? null
  const hash = await hashCommit(docJsonString, parentHash, params.documentId)

  const res = await fetch('/api/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'commit',
      hash,
      documentId: params.documentId,
      parentHash,
      kind: params.kind,
      message: params.message,
      docJson: docJsonString,
      blockIdsTouched: JSON.stringify(params.blockIdsTouched ?? []),
      annotationId: params.annotationId ?? undefined,
      auditIds: JSON.stringify(params.auditIds ?? []),
      actor: params.actor ?? 'human',
      modelVersion: params.modelVersion ?? '',
    }),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error ?? `Failed to save version (HTTP ${res.status})`)
  }
  const data = await res.json()
  return data.hash ?? hash
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

/**
 * Restore an old version (git-checkout semantics, append-only):
 *   1. Replace the editor content with the old snapshot — outside undo
 *      history, so Cmd-Z cannot half-revert a restore.
 *   2. Record a NEW 'restore' version whose parent is the pre-restore head.
 *      Nothing is deleted; the versions in between stay in the chain.
 *   3. Log an EU AI Act Article 14 human-oversight record: a restore is an
 *      explicit human decision about document content.
 *
 * Must only be invoked from behind a Confirmation gate.
 */
export async function restoreCommit(
  view: EditorView,
  commit: CommitWithDoc,
  documentId: string,
): Promise<string> {
  const restoredDoc = Node.fromJSON(view.state.schema, JSON.parse(commit.docJson))

  const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, restoredDoc.content)
  tr.setMeta('addToHistory', false)
  view.dispatch(tr)

  const shortHash = commit.hash.slice(0, 8)
  const newHash = await createCommit({
    docJson: commit.docJson,
    documentId,
    kind: 'restore',
    message: `Restored version ${shortHash}`,
    actor: 'human',
  })

  await logAuditEvent({
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
    overrideReason: `Restored version ${shortHash} (new version ${newHash.slice(0, 8)})`,
  })

  return newHash
}
