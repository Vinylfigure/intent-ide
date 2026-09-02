import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

/**
 * A raw NUL byte in a source file makes every grep-family tool classify that
 * file as binary and skip it silently. `src/lib/graphrag/docGraph.ts` carried
 * six of them for months — used, legitimately, as composite map-key
 * delimiters (`${from}\0${to}\0${type}`) but written as literal bytes rather
 * than the `\u0000` escape. The cost was not corruption: TypeScript, Next and
 * the tests all read it fine. The cost was that the repo's own retrieval
 * index became invisible to code search, so surveys of who used it came back
 * confidently incomplete.
 *
 * The escape sequence is equivalent at runtime and keeps the file text. This
 * guard exists so the byte cannot come back without someone being told.
 */

const SOURCE_ROOT = 'src'
const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.css'])
// Prisma's generated client is not hand-written and not ours to police.
const SKIP_DIRECTORIES = new Set(['generated', 'node_modules', '.next'])

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry)) sourceFiles(path, found)
    } else if (SCANNED_EXTENSIONS.has(extname(entry))) {
      found.push(path)
    }
  }
  return found
}

describe('source hygiene', () => {
  it('has no raw NUL bytes, which would hide a file from every code search', () => {
    const offenders = sourceFiles(SOURCE_ROOT)
      .map((path) => ({ path, count: readFileSync(path).filter((b) => b === 0).length }))
      .filter((f) => f.count > 0)
      .map((f) => `${f.path} (${f.count})`)

    expect(
      offenders,
      `Use the \\u0000 escape instead of a literal NUL byte in: ${offenders.join(', ')}`,
    ).toEqual([])
  })

  it('scans a plausible number of files, so a broken walk cannot pass vacuously', () => {
    // A guard that silently scans nothing always passes. This is the guard's guard.
    expect(sourceFiles(SOURCE_ROOT).length).toBeGreaterThan(50)
  })
})
