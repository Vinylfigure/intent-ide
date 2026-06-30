'use client'

import { useMemo } from 'react'

interface DiffViewerProps {
  before: string
  after: string
  title?: string
}

interface DiffSegment {
  type: 'same' | 'added' | 'removed'
  text: string
}

/**
 * Simple word-level diff. Splits text into words, finds longest common subsequence,
 * and marks additions/removals.
 */
function computeWordDiff(before: string, after: string): DiffSegment[] {
  const beforeWords = before.split(/(\s+)/)
  const afterWords = after.split(/(\s+)/)

  // LCS table (Myers-style would be better but this is sufficient for UI diffs)
  const m = beforeWords.length
  const n = afterWords.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (beforeWords[i - 1] === afterWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack to produce diff
  const segments: DiffSegment[] = []
  let i = m
  let j = n

  const rawSegments: DiffSegment[] = []
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && beforeWords[i - 1] === afterWords[j - 1]) {
      rawSegments.push({ type: 'same', text: beforeWords[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rawSegments.push({ type: 'added', text: afterWords[j - 1] })
      j--
    } else {
      rawSegments.push({ type: 'removed', text: beforeWords[i - 1] })
      i--
    }
  }

  rawSegments.reverse()

  // Merge adjacent same-type segments
  for (const seg of rawSegments) {
    const last = segments[segments.length - 1]
    if (last && last.type === seg.type) {
      last.text += seg.text
    } else {
      segments.push({ ...seg })
    }
  }

  return segments
}

export function DiffViewer({ before, after, title }: DiffViewerProps) {
  const segments = useMemo(() => computeWordDiff(before, after), [before, after])

  const hasChanges = segments.some((s) => s.type !== 'same')

  return (
    <div className="diff-viewer">
      {title && <div className="diff-viewer-title">{title}</div>}
      {!hasChanges ? (
        <div className="diff-viewer-no-changes">No changes</div>
      ) : (
        <div className="diff-viewer-content">
          {segments.map((seg, i) => {
            if (seg.type === 'same') {
              return <span key={i}>{seg.text}</span>
            }
            if (seg.type === 'removed') {
              return (
                <span key={i} className="diff-removed">
                  {seg.text}
                </span>
              )
            }
            return (
              <span key={i} className="diff-added">
                {seg.text}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
