'use client'

import { useState, useEffect, useCallback } from 'react'
import { getVisitorId } from '@/lib/audit/auditLogger'

interface AuditRecord {
  id: string
  timestampUTC: string
  userId: string
  modelName: string
  modelVersion: string
  promptVersion: string
  queryClassification: string
  confidenceScore: number | null
  responseId: string
  outputType: string
  regulatoryContext: string
  approvalStatus: string
  overrideOf: string | null
  overrideReason: string | null
}

type StatusFilter = 'ALL' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'MODIFIED'

const STATUS_COLORS: Record<string, string> = {
  PENDING_REVIEW: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  MODIFIED: 'bg-blue-100 text-blue-800',
}

export function AuditLogViewer() {
  const [records, setRecords] = useState<AuditRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchRecords = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Scope to this browser's records — unscoped reads are admin-only in prod.
      const params = new URLSearchParams({ limit: '100', userId: getVisitorId() })
      if (statusFilter !== 'ALL') params.set('status', statusFilter)
      const res = await fetch(`/api/audit?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setRecords(data.records ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { fetchRecords() }, [fetchRecords])

  return (
    <div className="p-4 space-y-4 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-muted">Audit Detail</h2>
        <button
          onClick={fetchRecords}
          className="status-chip px-2.5 py-1 rounded-full text-xs hover:text-ink transition-colors"
        >
          Refresh
        </button>
      </div>
      <p className="text-xs text-muted">
        Raw immutable audit events. Use the Changes panel for grouped review.
      </p>

      {/* Status filter */}
      <div className="flex gap-1 flex-wrap">
        {(['ALL', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'MODIFIED'] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-2.5 py-1 text-[10px] font-mono rounded-full transition-colors ${
              statusFilter === s
                ? 'bg-accent text-white shadow-sm'
                : 'bg-white/70 text-muted hover:text-ink'
            }`}
          >
            {s.replace('_', ' ')}
          </button>
        ))}
      </div>

      {loading && <p className="text-xs text-muted">Loading...</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}

      {!loading && records.length === 0 && (
        <p className="text-xs text-muted py-4 text-center">No audit records found.</p>
      )}

      {/* Records list */}
      <div className="space-y-1">
        {records.map((r) => (
          <div
            key={r.id}
            className="border border-border/70 rounded-2xl bg-white/80 text-xs cursor-pointer hover:border-accent/30 transition-colors shadow-sm"
            onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
          >
            <div className="flex items-center justify-between px-3 py-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${STATUS_COLORS[r.approvalStatus] ?? 'bg-gray-100 text-gray-600'}`}>
                  {r.approvalStatus}
                </span>
                <span className="text-muted truncate">{r.modelName}/{r.modelVersion}</span>
              </div>
              <span className="status-chip px-2 py-0.5 rounded-full text-[10px] font-mono shrink-0 ml-2">
                {new Date(r.timestampUTC).toLocaleTimeString()}
              </span>
            </div>

            {expandedId === r.id && (
              <div className="px-3 pb-3 pt-2 border-t border-border/70 space-y-1 font-mono text-[11px] bg-warm/20">
                <Row label="Audit ID" value={r.id} />
                <Row label="Timestamp" value={new Date(r.timestampUTC).toISOString()} />
                <Row label="User" value={r.userId} />
                <Row label="Model" value={`${r.modelName} / ${r.modelVersion}`} />
                <Row label="Prompt Version" value={r.promptVersion} />
                <Row label="Classification" value={r.queryClassification} />
                <Row label="Confidence" value={r.confidenceScore != null ? `${(r.confidenceScore * 100).toFixed(1)}%` : 'N/A'} />
                <Row label="Response ID" value={r.responseId} />
                <Row label="Output Type" value={r.outputType} />
                <Row label="Regulatory" value={r.regulatoryContext} />
                {r.overrideOf && <Row label="Override Of" value={r.overrideOf} />}
                {r.overrideReason && <Row label="Override Reason" value={r.overrideReason} />}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted shrink-0 w-28">{label}</span>
      <span className="text-ink break-all">{value || '\u2014'}</span>
    </div>
  )
}
