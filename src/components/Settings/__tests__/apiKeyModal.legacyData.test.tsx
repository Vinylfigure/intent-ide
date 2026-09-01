// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { ApiKeyModal } from '@/components/Settings/ApiKeyModal'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useChangesStore } from '@/stores/changesStore'
import { LEGACY_DOCUMENT_ID } from '@/lib/documents/legacyDocumentId'
import type { Annotation } from '@/lib/annotations/types'
import type { ChangeEntry, ChangeSet } from '@/lib/changes/changeLog'

function makeAnnotation(id: string, documentId: string): Annotation {
  return {
    id,
    documentId,
    locationGroupKey: `${documentId}:0:10`,
    type: 'ask',
    status: 'resolved',
    transcript: 'annotation',
    anchor: { from: 0, to: 10, scope: 'phrase', text: 'x' },
    resolution: null,
    conversation: [],
    parentId: null,
    childIds: [],
    createdAt: 0,
    resolvedAt: null,
    verbosity: 'normal',
  }
}

function makeEntry(id: string, documentId: string): ChangeEntry {
  return {
    id,
    documentId,
    rootAnnotationId: null,
    annotationId: null,
    timestamp: 0,
    description: 'edit',
    beforeSlice: 'before',
    afterSlice: 'after',
    from: 0,
    to: 1,
    pmStep: null,
    undone: false,
  }
}

function makeChangeSet(id: string, documentId: string): ChangeSet {
  return {
    id,
    documentId,
    rootAnnotationId: `root-${id}`,
    annotationIds: [`root-${id}`],
    changeEntryIds: [],
    auditRecordIds: [],
    title: 'Untitled review thread',
    status: 'pending',
    updatedAt: 0,
  }
}

afterEach(() => {
  cleanup()
  useAnnotationStore.setState({ annotations: [], activeAnnotationId: null })
  useChangesStore.setState({ entries: [], changeSets: [], snapshots: [] })
})

// Regression for #133: LEGACY_DOCUMENT_ID-scoped records (see legacyDocumentId.ts)
// are stamped onto migrated pre-Phase-8 annotations/changes but were permanently
// invisible — no UI path could view or clear them.
describe('ApiKeyModal legacy data section (#133)', () => {
  it('is not shown when there is no legacy data', () => {
    useAnnotationStore.setState({ annotations: [makeAnnotation('a-1', 'doc-1')] })

    const { queryByText } = render(<ApiKeyModal />)

    expect(queryByText('Legacy data')).toBeNull()
  })

  it('shows counts of legacy-scoped annotations, change sets, and changes', () => {
    useAnnotationStore.setState({
      annotations: [makeAnnotation('a-1', LEGACY_DOCUMENT_ID), makeAnnotation('a-2', LEGACY_DOCUMENT_ID)],
    })
    useChangesStore.setState({
      entries: [makeEntry('e-1', LEGACY_DOCUMENT_ID)],
      changeSets: [makeChangeSet('cs-1', LEGACY_DOCUMENT_ID)],
    })

    const { getByText } = render(<ApiKeyModal />)

    expect(getByText('Legacy data')).toBeTruthy()
    expect(getByText(/2 annotations, 1 change set, and 1 change/)).toBeTruthy()
  })

  it('clears legacy-scoped records from both stores and hides the section on click', () => {
    useAnnotationStore.setState({
      annotations: [makeAnnotation('a-1', LEGACY_DOCUMENT_ID), makeAnnotation('a-2', 'doc-1')],
    })
    useChangesStore.setState({
      entries: [makeEntry('e-1', LEGACY_DOCUMENT_ID), makeEntry('e-2', 'doc-1')],
      changeSets: [makeChangeSet('cs-1', LEGACY_DOCUMENT_ID)],
    })

    const { getByText, queryByText } = render(<ApiKeyModal />)

    fireEvent.click(getByText('Clear legacy data'))

    expect(queryByText('Legacy data')).toBeNull()
    expect(useAnnotationStore.getState().annotations.map((a) => a.id)).toEqual(['a-2'])
    expect(useChangesStore.getState().entries.map((e) => e.id)).toEqual(['e-2'])
    expect(useChangesStore.getState().changeSets).toEqual([])
  })
})
