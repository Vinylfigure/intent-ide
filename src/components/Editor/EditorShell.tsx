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
import { useChangesStore } from '@/stores/changesStore'
import { ConflictTooltip } from './ConflictTooltip'
import { UncertaintyTooltip } from './UncertaintyTooltip'
import { ProposedEditControl } from './ProposedEditControl'
import { FormattingToolbar } from './FormattingToolbar'

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
        docStore.saveDocument(
          docStore.activeDocumentId,
          view.state.doc.toJSON()
        )
      }
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
        if (transaction.docChanged) {
          debouncedSave(view)
        }
      },
    })

    viewRef.current = view
    setView(view)

    return () => {
      // Flush any pending save
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        const ds = useDocumentStore.getState()
        if (ds.activeDocumentId && ds.isDirty) {
          ds.saveDocument(ds.activeDocumentId, view.state.doc.toJSON())
        }
      }
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
      docStore.saveDocument(previousDocumentId, view.state.doc.toJSON())
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
        view.dispatch(tr)
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
    </div>
  )
}
