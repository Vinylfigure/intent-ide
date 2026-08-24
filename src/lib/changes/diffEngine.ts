// Word-level diff for displaying changes.
export interface DiffChunk {
  type: 'equal' | 'insert' | 'delete'
  text: string
}

/**
 * Word-level diff via longest common subsequence over whitespace-separated
 * tokens (whitespace runs are tokens too, so joins reproduce the originals
 * exactly). Unchanged runs come back as 'equal' chunks, so a one-word edit
 * marks one word — not everything after the first mismatch. Adjacent chunks
 * of the same type are merged.
 *
 * Slices here are bounded (annotation-sized), so the O(n·m) table is fine.
 */
export function computeWordDiff(before: string, after: string): DiffChunk[] {
  const beforeTokens = tokenize(before)
  const afterTokens = tokenize(after)
  const n = beforeTokens.length
  const m = afterTokens.length

  // lcs[i][j] = LCS length of beforeTokens[i..] and afterTokens[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        beforeTokens[i] === afterTokens[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const chunks: DiffChunk[] = []
  const push = (type: DiffChunk['type'], text: string) => {
    if (!text) return
    const last = chunks[chunks.length - 1]
    if (last && last.type === type) last.text += text
    else chunks.push({ type, text })
  }

  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (beforeTokens[i] === afterTokens[j]) {
      push('equal', beforeTokens[i])
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push('delete', beforeTokens[i])
      i++
    } else {
      push('insert', afterTokens[j])
      j++
    }
  }
  while (i < n) push('delete', beforeTokens[i++])
  while (j < m) push('insert', afterTokens[j++])

  return chunks
}

function tokenize(text: string): string[] {
  if (!text) return []
  return text.split(/(\s+)/).filter((token) => token !== '')
}
