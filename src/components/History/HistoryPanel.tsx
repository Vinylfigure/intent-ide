'use client'

import { useCallback, useEffect, useState } from 'react'
import { useDocumentStore } from '@/stores/documentStore'
import { useEditorStore } from '@/stores/editorStore'
import { useToastStore } from '@/stores/toastStore'
import {
  getCommit,
  listCommits,
  restoreCommit,
  type CommitKind,
  type CommitMeta,
} from '@/lib/history/commits'
import { docJsonToText } from '@/lib/history/docText'
import { DiffViewer } from '@/components/Editor/DiffViewer'
import { DiffView } from '@/components/Changes/DiffView'
import { Confirmation } from '@/components/ui/Confirmation'

// Word-level diffs stay readable up to a point; long documents fall back to
// the line-level view.
const WORD_DIFF_MAX_CHARS = 15000

const KIND_LABELS: Record<CommitKind, string> = {
  import: 'Created',
  apply: 'AI change',
  direct: 'Edit session',
  restore: 'Restored',
}

const KIND_STYLES: Record<CommitKind, string> = {
  import: 'bg-blue-100 text-blue-800',
  apply: 'bg-purple-100 text-purple-800',
  direct: 'bg-gray-100 text-gray-700',
  restore: 'bg-amber-100 text-amber-800',
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 14) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

function parseCount(jsonArray: string): number {
  try {
    const parsed = JSON.parse(jsonArray || '[]')
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

interface DiffPair {
  before: string
  after: string
  beforeLabel: string
  afterLabel: string
}

function VersionDiff({ before, after, beforeLabel, afterLabel }: DiffPair) {
  const useWordDiff = before.length < WORD_DIFF_MAX_CHARS && after.length < WORD_DIFF_MAX_CHARS
  return (
    <div className="mt-3 space-y-2">
      <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
        {beforeLabel} → {afterLabel}
      </p>
      {useWordDiff ? (
        <div className="rounded-xl border border-border/70 bg-white p-3 text-sm">
          <DiffViewer before={before} after={after} />
        </div>
      ) : (
        <DiffView before={before} after={after} />
      )}
    </div>
  )
}

export function HistoryPanel() {
  const activeDocumentId = useDocumentStore((s) => s.activeDocumentId)
  const [commits, setCommits] = useState<CommitMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedHash, setExpandedHash] = useState<string | null>(null)
  const [expandedDiff, setExpandedDiff] = useState<DiffPair | 'loading' | 'first' | null>(null)
  const [compareMode, setCompareMode] = useState(false)
  const [compareSelection, setCompareSelection] = useState<string[]>([])
  const [compareDiff, setCompareDiff] = useState<DiffPair | 'loading' | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<CommitMeta | null>(null)
  const [restoring, setRestoring] = useState(false)

  const fetchHistory = useCallback(async () => {
    if (!activeDocumentId) {
      setCommits([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      setCommits(await listCommits(activeDocumentId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load version history')
    } finally {
      setLoading(false)
    }
  }, [activeDocumentId])

  useEffect(() => {
    fetchHistory()
    setExpandedHash(null)
    setExpandedDiff(null)
    setCompareMode(false)
    setCompareSelection([])
    setCompareDiff(null)
  }, [fetchHistory])

  const shortLabel = (hash: string) => `version ${hash.slice(0, 8)}`

  const loadRowDiff = async (commit: CommitMeta) => {
    if (!commit.parentHash) {
      setExpandedDiff('first')
      return
    }
    setExpandedDiff('loading')
    try {
      const [current, previous] = await Promise.all([
        getCommit(commit.hash),
        getCommit(commit.parentHash),
      ])
      if (!current || !previous) throw new Error('Version content unavailable')
      setExpandedDiff({
        before: docJsonToText(previous.docJson),
        after: docJsonToText(current.docJson),
        beforeLabel: 'Previous version',
        afterLabel: 'This version',
      })
    } catch (err) {
      setExpandedDiff(null)
      useToastStore.getState().addToast(
        err instanceof Error ? err.message : 'Could not load the comparison',
        'error',
      )
    }
  }

  const toggleExpanded = (commit: CommitMeta) => {
    if (expandedHash === commit.hash) {
      setExpandedHash(null)
      setExpandedDiff(null)
      return
    }
    setExpandedHash(commit.hash)
    loadRowDiff(commit)
  }

  const toggleCompareSelection = async (hash: string) => {
    const next = compareSelection.includes(hash)
      ? compareSelection.filter((h) => h !== hash)
      : [...compareSelection.slice(-1), hash]
    setCompareSelection(next)
    setCompareDiff(null)

    if (next.length === 2) {
      setCompareDiff('loading')
      try {
        const [a, b] = await Promise.all([getCommit(next[0]), getCommit(next[1])])
        if (!a || !b) throw new Error('Version content unavailable')
        const [older, newer] =
          new Date(a.createdAt).getTime() <= new Date(b.createdAt).getTime() ? [a, b] : [b, a]
        setCompareDiff({
          before: docJsonToText(older.docJson),
          after: docJsonToText(newer.docJson),
          beforeLabel: shortLabel(older.hash),
          afterLabel: shortLabel(newer.hash),
        })
      } catch (err) {
        setCompareDiff(null)
        useToastStore.getState().addToast(
          err instanceof Error ? err.message : 'Could not load the comparison',
          'error',
        )
      }
    }
  }

  const handleRestore = async () => {
    const target = restoreTarget
    const view = useEditorStore.getState().view
    if (!target || !view || !activeDocumentId || restoring) return
    setRestoring(true)
    try {
      const full = await getCommit(target.hash)
      if (!full) throw new Error('Version content unavailable')
      await restoreCommit(view, full, activeDocumentId)
      useToastStore.getState().addToast('Version restored — a new version was created', 'success')
      setRestoreTarget(null)
      setExpandedHash(null)
      setExpandedDiff(null)
      await fetchHistory()
    } catch (err) {
      useToastStore.getState().addToast(
        err instanceof Error ? err.message : 'Restore failed',
        'error',
      )
    } finally {
      setRestoring(false)
    }
  }

  if (!activeDocumentId) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center px-6">
        <p className="text-sm text-muted">No document selected</p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-muted">History</h2>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              setCompareMode((prev) => !prev)
              setCompareSelection([])
              setCompareDiff(null)
            }}
            className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
              compareMode
                ? 'bg-accent text-white shadow-sm'
                : 'status-chip hover:text-ink'
            }`}
          >
            Compare
          </button>
          <button
            onClick={fetchHistory}
            className="status-chip px-2.5 py-1 rounded-full text-xs hover:text-ink transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>
      <p className="text-xs text-muted">
        Every saved version of this document. Restoring never deletes anything — it adds a new
        version on top.
      </p>

      {compareMode && (
        <div className="rounded-2xl border border-accent/30 bg-accent/5 px-3 py-2.5">
          <p className="text-xs text-ink">
            Pick two versions to compare
            {compareSelection.length > 0 && (
              <span className="text-muted-foreground"> — {compareSelection.length} of 2 selected</span>
            )}
          </p>
          {compareDiff === 'loading' && <p className="mt-2 text-xs text-muted">Loading comparison...</p>}
          {compareDiff && compareDiff !== 'loading' && <VersionDiff {...compareDiff} />}
        </div>
      )}

      {loading && <p className="text-xs text-muted">Loading...</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}

      {!loading && !error && commits.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 text-center px-4">
          <div className="w-12 h-12 rounded-full bg-warm flex items-center justify-center mb-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted">
              <circle cx="12" cy="12" r="9" />
              <polyline points="12 7 12 12 15.5 13.5" />
            </svg>
          </div>
          <p className="text-sm text-muted">No versions yet</p>
          <p className="text-xs text-muted/60 mt-1 max-w-56">
            Every version of this document is kept here — created, AI changes you approved, your
            edit sessions, and restores.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        {commits.map((commit, index) => {
          const isHead = index === 0
          const auditCount = parseCount(commit.auditIds)
          const expanded = expandedHash === commit.hash
          const selectedForCompare = compareSelection.includes(commit.hash)
          return (
            <div
              key={commit.hash}
              className={`border rounded-2xl bg-white/80 text-xs shadow-sm transition-colors ${
                selectedForCompare ? 'border-accent/60' : 'border-border/70 hover:border-accent/30'
              }`}
            >
              <div
                className="px-3 py-3 cursor-pointer"
                onClick={() =>
                  compareMode ? toggleCompareSelection(commit.hash) : toggleExpanded(commit)
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {compareMode && (
                      <span
                        aria-hidden
                        className={`w-3.5 h-3.5 shrink-0 rounded-full border ${
                          selectedForCompare ? 'bg-accent border-accent' : 'border-border'
                        }`}
                      />
                    )}
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono shrink-0 ${KIND_STYLES[commit.kind] ?? 'bg-gray-100 text-gray-600'}`}>
                      {KIND_LABELS[commit.kind] ?? commit.kind}
                    </span>
                    <span className="text-ink font-medium truncate">{commit.message}</span>
                  </div>
                  <span className="status-chip px-2 py-0.5 rounded-full text-[10px] font-mono shrink-0">
                    {relativeTime(commit.createdAt)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <span className="px-1.5 py-0.5 rounded-full bg-warm text-[10px] text-muted-foreground">
                    {commit.actor === 'ai+human' ? 'AI + you' : 'You'}
                  </span>
                  {auditCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full bg-warm text-[10px] text-muted-foreground">
                      {auditCount} audit record{auditCount > 1 ? 's' : ''}
                    </span>
                  )}
                  {isHead && (
                    <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px]">
                      Current
                    </span>
                  )}
                  <span className="text-[10px] font-mono text-muted-foreground/60 ml-auto">
                    {commit.hash.slice(0, 8)}
                  </span>
                </div>
              </div>

              {!compareMode && expanded && (
                <div className="px-3 pb-3 border-t border-border/70 bg-warm/20">
                  {expandedDiff === 'loading' && (
                    <p className="pt-3 text-xs text-muted">Loading comparison...</p>
                  )}
                  {expandedDiff === 'first' && (
                    <p className="pt-3 text-xs text-muted-foreground">
                      This is the first version of the document — there is nothing earlier to
                      compare against.
                    </p>
                  )}
                  {expandedDiff && expandedDiff !== 'loading' && expandedDiff !== 'first' && (
                    <VersionDiff {...expandedDiff} />
                  )}
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setRestoreTarget(commit)
                      }}
                      disabled={isHead}
                      title={isHead ? 'This is already the current version' : 'Restore this version'}
                      className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                        isHead
                          ? 'bg-muted/20 text-muted-foreground cursor-not-allowed opacity-50'
                          : 'bg-ink text-white hover:bg-ink/80'
                      }`}
                    >
                      Restore this version
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {commits.length > 0 && (
        <p className="text-[10px] text-muted-foreground/70 pt-1">
          Version history is immutable and linked to the audit trail (EU AI Act Art. 12 &amp; 14).
        </p>
      )}

      {restoreTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
            <Confirmation
              title="Restore this version?"
              description={`The document will go back to "${restoreTarget.message}" from ${relativeTime(restoreTarget.createdAt)}. A new version will be created on top of your history — nothing is deleted, and you can restore any other version later.`}
              confirmLabel={restoring ? 'Restoring...' : 'Restore'}
              cancelLabel="Cancel"
              onConfirm={handleRestore}
              onCancel={() => {
                if (!restoring) setRestoreTarget(null)
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
