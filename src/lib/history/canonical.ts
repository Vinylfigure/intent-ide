/**
 * Canonical serialization for content-addressed document versions.
 *
 * The version hash is a sha256 over a canonical string derived from
 * (documentId, parentHash, docJson). Both the client (crypto.subtle in the
 * browser) and the server (/api/history, Node's WebCrypto) import THIS module
 * so the payload is byte-identical on both sides — the server recomputes the
 * hash and rejects mismatches, which is what makes history tamper-evident.
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
 * The exact string that gets hashed for a version. `docJson` may arrive as an
 * object or as a JSON string (the API stores it as a string) — both normalize
 * to the same canonical form.
 */
export function commitPayload(
  docJson: unknown,
  parentHash: string | null,
  documentId: string,
): string {
  const parsed = typeof docJson === 'string' ? JSON.parse(docJson) : docJson
  return `${documentId}\n${parentHash ?? ''}\n${canonicalStringify(parsed)}`
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

/** Content-address for a version: sha256 over the canonical payload. */
export async function computeCommitHash(
  docJson: unknown,
  parentHash: string | null,
  documentId: string,
): Promise<string> {
  return sha256Hex(commitPayload(docJson, parentHash, documentId))
}
