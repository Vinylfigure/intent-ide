export interface ChangeEntry {
  id: string
  documentId: string
  rootAnnotationId: string | null
  annotationId: string | null
  timestamp: number
  description: string
  beforeSlice: string
  afterSlice: string
  from: number
  to: number
  pmStep: any
  undone: boolean
}

export type ChangeSetStatus = 'pending' | 'approved' | 'rejected' | 'modified'

export interface ChangeSet {
  id: string
  documentId: string
  rootAnnotationId: string
  annotationIds: string[]
  changeEntryIds: string[]
  auditRecordIds: string[]
  title: string
  status: ChangeSetStatus
  updatedAt: number
  /** Document version recorded when this change set was applied (see src/lib/history). */
  commitHash?: string
}

export interface VersionSnapshot {
  id: string
  docJson: any
  changeIds: string[]
  timestamp: number
}
