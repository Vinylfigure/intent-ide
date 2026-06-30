// Simple diff computation for displaying changes
export interface DiffChunk {
  type: 'equal' | 'insert' | 'delete'
  text: string
}

export function computeSimpleDiff(before: string, after: string): DiffChunk[] {
  // Simple word-level diff
  const beforeWords = before.split(/(\s+)/)
  const afterWords = after.split(/(\s+)/)

  const chunks: DiffChunk[] = []
  let i = 0
  let j = 0

  while (i < beforeWords.length || j < afterWords.length) {
    if (i < beforeWords.length && j < afterWords.length && beforeWords[i] === afterWords[j]) {
      chunks.push({ type: 'equal', text: beforeWords[i] })
      i++
      j++
    } else if (i < beforeWords.length) {
      chunks.push({ type: 'delete', text: beforeWords[i] })
      i++
    } else if (j < afterWords.length) {
      chunks.push({ type: 'insert', text: afterWords[j] })
      j++
    }
  }

  return chunks
}
