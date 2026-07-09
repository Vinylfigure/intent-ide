/**
 * Canonical serialization + two-level hashing for document versions.
 *
 * Git's actual design, deliberately:
 *   - contentHash ("tree"): sha256 over the canonical docJson ONLY.
 *   - hash ("commit", the primary key): sha256 over a canonical join of
 *     documentId, parentHash, contentHash, kind, message, actor,
 *     annotationId, auditIds and modelVersion.
 *
 * Because the commit hash covers attribution, two versions that agree on
 * content but disagree on provenance (e.g. an AI 'apply' and a 'direct'
 * autosave landing on the same head) are DISTINCT records by construction —
 * provenance can never be silently collapsed into a single row. The server
 * (/api/history) recomputes BOTH hashes from this same module, so client and
 * server are byte-identical and stored records are tamper-evident against
 * partial modification.
 *
 * Pure module: no React, no Prisma, no DOM. Safe to import anywhere.
 */

/**
 * Deterministic JSON stringify: object keys are emitted in sorted order at
 * every depth, arrays keep their order. Two structurally-equal values always
 * produce the same string regardless of key insertion order.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item ?? null)).join(',')}]`
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
  const body = keys
    .map((key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`)
    .join(',')
  return `{${body}}`
}

/**
 * The exact string whose sha256 is the CONTENT hash ("tree"). `docJson` may
 * arrive as an object or as a JSON string (the API stores it as a string) —
 * both normalize to the same canonical form.
 */
export function contentPayload(docJson: unknown): string {
  const parsed = typeof docJson === 'string' ? JSON.parse(docJson) : docJson
  return canonicalStringify(parsed)
}

/** Content address for a snapshot: sha256 over the canonical docJson only. */
export async function computeContentHash(docJson: unknown): Promise<string> {
  return sha256Hex(contentPayload(docJson))
}

/** Everything the COMMIT hash covers — content (via contentHash) plus attribution. */
export interface CommitHashFields {
  documentId: string
  parentHash: string | null
  contentHash: string
  kind: string
  message: string
  actor: string
  annotationId: string | null
  /** Audit record ids as an array (its canonical JSON form is what gets hashed). */
  auditIds: string[]
  modelVersion: string
}

/**
 * The exact string whose sha256 is the COMMIT hash. A canonical object
 * stringify (sorted keys, JSON-escaped values) — unambiguous even when
 * fields contain newlines or separators.
 */
export function commitPayload(fields: CommitHashFields): string {
  return canonicalStringify({
    documentId: fields.documentId,
    parentHash: fields.parentHash ?? null,
    contentHash: fields.contentHash,
    kind: fields.kind,
    message: fields.message,
    actor: fields.actor,
    annotationId: fields.annotationId ?? '',
    auditIds: fields.auditIds,
    modelVersion: fields.modelVersion,
  })
}

/** Commit address for a version: sha256 over the canonical commit payload. */
export async function computeCommitHash(fields: CommitHashFields): Promise<string> {
  return sha256Hex(commitPayload(fields))
}

/**
 * sha256 hex digest via WebCrypto — available in browsers and Node 18+
 * (globalThis.crypto.subtle), so client and server share one implementation.
 */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
