'use client'

import { useEffect, useRef, useCallback } from 'react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { Node } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'
import { createPlugins } from '@/lib/prosemirror/plugins'
import { useEditorStore } from '@/stores/editorStore'
import { useDocumentStore } from '@/stores/documentStore'
import { setChangeCallback } from '@/lib/prosemirror/plugins/changeTrackingPlugin'
import { scheduleDocGraphRebuild, cancelScheduledDocGraphRebuild } from '@/lib/graphrag/docGraph'
import { useChangesStore } from '@/stores/changesStore'
import { recordCommit } from '@/lib/history/commits'
import {
  observeTransaction,
  resetDirectEditBaseline,
  settleDirectEdits,
} from '@/lib/annotations/directEditTrigger'
import { useDirectEditOfferStore } from '@/stores/directEditOfferStore'
import { ConflictTooltip } from './ConflictTooltip'
import { UncertaintyTooltip } from './UncertaintyTooltip'
import { ProposedEditControl } from './ProposedEditControl'
import { FormattingToolbar } from './FormattingToolbar'
import { DirectEditCascadeChip } from './DirectEditCascadeChip'

const AUTOSAVE_DELAY = 5000 // 5 seconds idle

export function EditorShell() {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previousDocumentIdRef = useRef<string | null>(null)
  const setView = useEditorStore((s) => s.setView)
  const activeDocumentId = useDocumentStore((s) => s.activeDocumentId)

  const debouncedSave = useCallback((view: EditorView) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    useDocumentStore.getState().setDirty(true)
    saveTimerRef.current = setTimeout(() => {
      const docStore = useDocumentStore.getState()
      if (docStore.activeDocumentId) {
        const docJson = view.state.doc.toJSON()
        docStore.saveDocument(docStore.activeDocumentId, docJson)
        // Version-history capture (fire-and-forget). Content-hash dedupe
        // makes flushes with unchanged content free.
        recordCommit({
          docJson,
          documentId: docStore.activeDocumentId,
          kind: 'direct',
          message: 'Edited document',
          actor: 'human',
        })
      }
      // Direct-edit cascade trigger (Flow v1 P4): the autosave flush is the
      // "settled" point — diff human-touched blocks against the baseline and
      // offer a dependency check via the quiet chip. Deterministic graph only
      // (zero network); errors are swallowed — an offer must never break saves.
      settleDirectEdits(view.state)
        .then((offer) => {
          if (offer) useDirectEditOfferStore.getState().setOffer(offer)
        })
        .catch(() => {})
    }, AUTOSAVE_DELAY)
  }, [])

  useEffect(() => {
    if (!editorRef.current || viewRef.current) return

    // Set up change tracking callback
    setChangeCallback((change) => {
      const activeDocId = useDocumentStore.getState().activeDocumentId ?? 'unknown'
      useChangesStore.getState().addEntry({
        id: change.id,
        documentId: activeDocId,
        rootAnnotationId: null,
        annotationId: null,
        timestamp: Date.now(),
        description: 'Direct edit',
        beforeSlice: change.beforeSlice,
        afterSlice: change.afterSlice,
        from: change.from,
        to: change.to,
        pmStep: change.steps,
        undone: false,
      })
    })

    // Try to restore active document
    const docStore = useDocumentStore.getState()
    let doc: Node | undefined
    if (docStore.activeDocumentId) {
      const json = docStore.loadDocumentJson(docStore.activeDocumentId)
      if (json) {
        try {
          doc = Node.fromJSON(schema, json)
        } catch {
          // Corrupted JSON — fall through to empty doc
        }
      }
    }

    const state = EditorState.create({
      schema,
      doc,
      plugins: createPlugins(),
    })

    const view = new EditorView(editorRef.current, {
      state,
      dispatchTransaction(transaction) {
        const newState = view.state.apply(transaction)
        view.updateState(newState)
        // Direct-edit cascade trigger: record which blocks HUMAN transactions
        // touched (AI applies, undo/redo, stamps, and state loads are skipped
        // inside observeTransaction).
        observeTransaction(transaction, view.state.doc)
        if (transaction.docChanged) {
          debouncedSave(view)
          scheduleDocGraphRebuild(view)
        }
      },
    })

    viewRef.current = view
    setView(view)
    // The restored (or empty) mount doc is the first direct-edit baseline.
    resetDirectEditBaseline(view.state.doc)

    return () => {
      // Flush any pending save
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        const ds = useDocumentStore.getState()
        if (ds.activeDocumentId && ds.isDirty) {
          const docJson = view.state.doc.toJSON()
          ds.saveDocument(ds.activeDocumentId, docJson)
          // Keep history in step with localStorage: without this, an unmount
          // flush leaves localStorage permanently ahead of the version chain.
          // Content-hash dedupe makes it free when nothing changed.
          recordCommit({
            docJson,
            documentId: ds.activeDocumentId,
            kind: 'direct',
            message: 'Edited document',
            actor: 'human',
          })
        }
      }
      cancelScheduledDocGraphRebuild()
      view.destroy()
      viewRef.current = null
      setView(null)
    }
  }, [setView, debouncedSave])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const previousDocumentId = previousDocumentIdRef.current
    if (activeDocumentId === previousDocumentId) return

    const docStore = useDocumentStore.getState()

    if (previousDocumentId && docStore.isDirty) {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      const docJson = view.state.doc.toJSON()
      docStore.saveDocument(previousDocumentId, docJson)
      // Doc-switch flush must reach the version chain too (see unmount flush
      // above) — dedupe makes it a no-op when the content is unchanged.
      recordCommit({
        docJson,
        documentId: previousDocumentId,
        kind: 'direct',
        message: 'Edited document',
        actor: 'human',
      })
    }

    const json = activeDocumentId
      ? docStore.loadDocumentJson(activeDocumentId)
      : schema.topNodeType.createAndFill()?.toJSON()

    if (json) {
      try {
        const nextDoc = Node.fromJSON(schema, json)
        const tr = view.state.tr.replaceWith(
          0,
          view.state.doc.content.size,
          nextDoc.content
        )
        // A document SWITCH is not an edit: keeping it out of history stops
        // Cmd-Z from resurrecting the previous document's content and then
        // autosaving it under the new document's id.
        tr.setMeta('addToHistory', false)
        view.dispatch(tr)
        // A document SWITCH also resets the direct-edit baseline: pending
        // touches belong to the previous document, and any visible offer is
        // stale against the new one.
        resetDirectEditBaseline(view.state.doc)
        useDirectEditOfferStore.getState().clearOffer()
      } catch {
        // keep current document if replacement payload is invalid
      }
    }

    previousDocumentIdRef.current = activeDocumentId
    docStore.setDirty(false)
  }, [activeDocumentId])

  return (
    <div className="editor-container">
      <FormattingToolbar />
      <div ref={editorRef} className="prosemirror-mount" />
      <ConflictTooltip />
      <UncertaintyTooltip />
      <ProposedEditControl />
      <DirectEditCascadeChip />
    </div>
  )
}
