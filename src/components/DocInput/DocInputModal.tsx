'use client'

import { useState } from 'react'
import { schema } from '@/lib/prosemirror/schema'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useChangesStore } from '@/stores/changesStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useDocumentStore } from '@/stores/documentStore'
import { useToastStore } from '@/stores/toastStore'
import { parseTextToDoc, parseFileToDoc } from '@/lib/docInput/parser'
import { generateDocument } from '@/lib/docInput/generator'

interface DocInputModalProps {
  onClose: () => void
}

type InputMode = 'blank' | 'paste' | 'generate' | 'import'

export function DocInputModal({ onClose }: DocInputModalProps) {
  const [mode, setMode] = useState<InputMode>('blank')
  const [pasteText, setPasteText] = useState('')
  const [generatePrompt, setGeneratePrompt] = useState('')
  const [title, setTitle] = useState('')
  const [collectionId, setCollectionId] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const view = useEditorStore((s) => s.view)
  const llmConfig = useSettingsStore((s) => s.llmConfig)
  const collections = useDocumentStore((s) => s.collections)

  const loadDoc = (docJson: any, fallbackTitle: string) => {
    if (!view) return
    const doc = schema.nodeFromJSON(docJson)
    const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content)
    view.dispatch(tr)

    // Save to document store
    const docTitle = title.trim() || fallbackTitle || 'Untitled'
    useDocumentStore.getState().createDocument(docTitle, doc.toJSON(), {
      collectionIds: collectionId ? [collectionId] : [],
    })

    // Reset session state for new document
    useAnnotationStore.getState().clear()
    useChangesStore.getState().clear()
    useSessionStore.getState().reset()

    onClose()
  }

  const handleBlank = () => {
    const blank = schema.topNodeType.createAndFill()
    if (!blank) return
    loadDoc(blank.toJSON(), 'Untitled')
  }

  const handlePaste = () => {
    if (!pasteText.trim()) return
    const doc = parseTextToDoc(pasteText)
    const fallbackTitle = pasteText.split('\n')[0]?.replace(/^#+\s*/, '').slice(0, 60) || 'Untitled'
    loadDoc(doc.toJSON(), fallbackTitle)
  }

  const handleGenerate = async () => {
    if (!generatePrompt.trim()) return
    if (!llmConfig.apiKey) {
      useSettingsStore.getState().setShowApiKeyModal(true)
      return
    }

    const toastId = useToastStore.getState().addToast('Generating document...', 'loading')
    setIsGenerating(true)
    setError(null)
    try {
      const content = await generateDocument(generatePrompt, llmConfig)
      const doc = parseTextToDoc(content)
      loadDoc(doc.toJSON(), generatePrompt.slice(0, 60) || 'Generated document')
      useToastStore.getState().removeToast(toastId)
      useToastStore.getState().addToast('Document generated!', 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation failed'
      setError(message)
      useToastStore.getState().removeToast(toastId)
      useToastStore.getState().addToast(message, 'error')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const text = await file.text()
    if (!view) return
    const doc = parseFileToDoc(text, file.name)
    const fallbackTitle = file.name.replace(/\.[^.]+$/, '') || 'Imported Document'
    loadDoc(doc.toJSON(), fallbackTitle)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-serif text-xl">Load Document</h2>
          <button onClick={onClose} className="text-muted hover:text-ink text-xl leading-none">&times;</button>
        </div>

        {/* Mode tabs */}
        <div className="flex border-b border-border">
          {(['blank', 'paste', 'generate', 'import'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
                mode === m
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-muted hover:text-ink'
              }`}
            >
              {m === 'blank' ? 'Blank' : m === 'paste' ? 'Paste' : m === 'generate' ? 'Generate' : 'Import File'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="grid gap-4 md:grid-cols-2 mb-5">
            <label className="space-y-1">
              <span className="text-xs font-mono uppercase tracking-wider text-muted">Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Untitled"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-mono uppercase tracking-wider text-muted">Collection</span>
              <select
                value={collectionId}
                onChange={(e) => setCollectionId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
              >
                <option value="">No collection</option>
                {collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>
                    {collection.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {mode === 'blank' && (
            <div>
              <div className="h-40 border border-dashed border-border rounded-lg flex items-center justify-center bg-warm/30 text-center px-8">
                <div>
                  <p className="text-sm text-ink">Create a fresh document.</p>
                  <p className="text-xs text-muted mt-1">Use a title now and start writing from a clean page.</p>
                </div>
              </div>
              <button
                onClick={handleBlank}
                className="mt-3 px-4 py-2 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/80 transition-colors"
              >
                Create Blank Document
              </button>
            </div>
          )}

          {mode === 'paste' && (
            <div>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste your document here... (supports markdown)"
                className="w-full h-64 p-4 text-sm font-mono border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
              />
              <button
                onClick={handlePaste}
                disabled={!pasteText.trim()}
                className="mt-3 px-4 py-2 bg-ink text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-ink/80 transition-colors"
              >
                Load Document
              </button>
            </div>
          )}

          {mode === 'generate' && (
            <div>
              <textarea
                value={generatePrompt}
                onChange={(e) => setGeneratePrompt(e.target.value)}
                placeholder="Describe the document you want to generate..."
                className="w-full h-40 p-4 text-sm border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
              />
              {error && <p className="mt-2 text-sm text-accent">{error}</p>}
              <button
                onClick={handleGenerate}
                disabled={!generatePrompt.trim() || isGenerating}
                className="mt-3 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-accent/80 transition-colors"
              >
                {isGenerating ? 'Generating...' : 'Generate Document'}
              </button>
              {!llmConfig.apiKey && (
                <p className="mt-2 text-xs text-muted">Set an API key first to generate documents.</p>
              )}
            </div>
          )}

          {mode === 'import' && (
            <div>
              <label className="flex flex-col items-center justify-center h-40 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-accent/50 hover:bg-warm/50 transition-colors">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted mb-2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span className="text-sm text-muted">Click to upload or drag a file</span>
                <span className="text-xs text-muted/60 mt-1">.md, .txt, .html</span>
                <input
                  type="file"
                  accept=".md,.txt,.markdown,.text,.html,.htm"
                  onChange={handleFileImport}
                  className="hidden"
                />
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
