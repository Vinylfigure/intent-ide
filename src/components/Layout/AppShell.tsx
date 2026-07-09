'use client'

import { useState, useEffect } from 'react'
import { EditorShell } from '@/components/Editor/EditorShell'
import { AnnotationPanel } from '@/components/Annotations/AnnotationPanel'
import { ChangesPanel } from '@/components/Changes/ChangesPanel'
import { VoiceButton } from '@/components/Voice/VoiceButton'
import { VoiceOverlay } from '@/components/Voice/VoiceOverlay'
import { StatusBar } from '@/components/Layout/StatusBar'
import { ApiKeyModal } from '@/components/Settings/ApiKeyModal'
import { AgentConfigPanel } from '@/components/Settings/AgentConfigPanel'
import { DocumentHubSidebar } from '@/components/Layout/DocumentHubSidebar'
import { AuditLogViewer } from '@/components/Annotations/AuditLogViewer'
import { HistoryPanel } from '@/components/History/HistoryPanel'
import { DocInputModal } from '@/components/DocInput/DocInputModal'
import { ToastContainer } from '@/components/Layout/ToastContainer'
import { FloatingIconBar } from '@/components/Editor/FloatingIconBar'
import { CommandPalette } from '@/components/Layout/CommandPalette'
import { useSettingsStore } from '@/stores/settingsStore'
import { useEditorStore } from '@/stores/editorStore'
import { useVoiceStore } from '@/stores/voiceStore'
import { useDocumentStore } from '@/stores/documentStore'
import { initHotkeyListener, registerHotkey } from '@/lib/utils/hotkeys'
import { toggleVoiceCapture } from '@/lib/voice/pipeline'
import { triggerFloatingBar } from '@/lib/prosemirror/plugins/contextMenuPlugin'

type SidebarTab = 'annotations' | 'changes' | 'documents' | 'history' | 'audit'

export function AppShell() {
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('annotations')
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [showDocInput, setShowDocInput] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showAgentConfig, setShowAgentConfig] = useState(false)
  const showApiKeyModal = useSettingsStore((s) => s.showApiKeyModal)
  const isRecording = useVoiceStore((s) => s.isRecording)
  const activeDocumentId = useDocumentStore((s) => s.activeDocumentId)
  const isDirty = useDocumentStore((s) => s.isDirty)
  const lastSavedAt = useDocumentStore((s) => s.lastSavedAt)
  const activeDocumentTitle = useDocumentStore((s) => s.documents.find((doc) => doc.id === s.activeDocumentId)?.title ?? null)

  // Auto-select or prompt for document when none is active
  useEffect(() => {
    if (!activeDocumentId) {
      const docStore = useDocumentStore.getState()
      if (docStore.documents.length === 0) {
        // First-time user: show new document modal
        setShowDocInput(true)
      } else {
        // Existing docs but none active: auto-select most recent
        const recent = docStore.getRecentDocs()
        if (recent.length > 0) {
          docStore.setActiveDocument(recent[0].id)
        }
      }
    }
  }, [activeDocumentId])

  // Warn on unsaved changes before unload
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (useDocumentStore.getState().isDirty) {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  // Initialize hotkeys
  useEffect(() => {
    const cleanup = initHotkeyListener()
    const unregisterVoice = registerHotkey({
      key: ' ',
      ctrl: true,
      handler: (e) => {
        e.preventDefault()
        const settings = useSettingsStore.getState()
        if (settings.llmConfig.provider === 'ollama' || settings.llmConfig.apiKey) {
          toggleVoiceCapture()
        } else {
          settings.setShowApiKeyModal(true)
        }
      },
    })

    // Ctrl+E for floating icon bar
    const unregisterFloatingBar = registerHotkey({
      key: 'e',
      ctrl: true,
      handler: (e) => {
        e.preventDefault()
        const view = useEditorStore.getState().view
        if (!view) return
        const { from, to } = view.state.selection
        if (from === to) return
        triggerFloatingBar(view)
      },
    })

    // Cmd+K for command palette
    function handleCmdK(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowCommandPalette((prev) => !prev)
      }
    }
    document.addEventListener('keydown', handleCmdK)

    // Listen for sidebar switch events from command palette
    function handleSidebarEvent(e: Event) {
      const detail = (e as CustomEvent).detail
      if (detail === 'annotations' || detail === 'changes' || detail === 'documents') {
        setSidebarTab(detail)
        setIsSidebarCollapsed(false)
      }
    }
    window.addEventListener('intent-ide:sidebar', handleSidebarEvent)

    // Listen for new doc event from command palette
    function handleNewDoc() {
      setShowDocInput(true)
    }
    window.addEventListener('intent-ide:new-doc', handleNewDoc)

    return () => {
      cleanup()
      unregisterVoice()
      unregisterFloatingBar()
      document.removeEventListener('keydown', handleCmdK)
      window.removeEventListener('intent-ide:sidebar', handleSidebarEvent)
      window.removeEventListener('intent-ide:new-doc', handleNewDoc)
    }
  }, [])

  return (
    <div className="flex flex-col h-screen app-shell-backdrop">
      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        {!isSidebarCollapsed ? (
        <div className="w-80 border-r border-border/70 panel-shell flex flex-col shrink-0">
          {/* Sidebar tabs */}
          <div className="flex items-center border-b border-border/70 bg-white/55">
            <button
              onClick={() => setSidebarTab('annotations')}
              className={`flex-1 px-4 py-3 text-[10px] font-mono uppercase tracking-[0.24em] transition-colors ${
                sidebarTab === 'annotations'
                  ? 'text-accent border-b-2 border-accent bg-white/80'
                  : 'text-muted hover:text-ink hover:bg-white/40'
              }`}
            >
              Annotations
            </button>
            <button
              onClick={() => setSidebarTab('changes')}
              className={`flex-1 px-4 py-3 text-[10px] font-mono uppercase tracking-[0.24em] transition-colors ${
                sidebarTab === 'changes'
                  ? 'text-accent border-b-2 border-accent bg-white/80'
                  : 'text-muted hover:text-ink hover:bg-white/40'
              }`}
            >
              Changes
            </button>
            <button
              onClick={() => setSidebarTab('documents')}
              className={`flex-1 px-4 py-3 text-[10px] font-mono uppercase tracking-[0.24em] transition-colors ${
                sidebarTab === 'documents'
                  ? 'text-accent border-b-2 border-accent bg-white/80'
                  : 'text-muted hover:text-ink hover:bg-white/40'
              }`}
            >
              Documents
            </button>
            <button
              onClick={() => setSidebarTab('history')}
              className={`flex-1 px-4 py-3 text-[10px] font-mono uppercase tracking-[0.24em] transition-colors ${
                sidebarTab === 'history'
                  ? 'text-accent border-b-2 border-accent bg-white/80'
                  : 'text-muted hover:text-ink hover:bg-white/40'
              }`}
            >
              History
            </button>
            <button
              onClick={() => setSidebarTab('audit')}
              className={`flex-1 px-4 py-3 text-[10px] font-mono uppercase tracking-[0.24em] transition-colors ${
                sidebarTab === 'audit'
                  ? 'text-accent border-b-2 border-accent bg-white/80'
                  : 'text-muted hover:text-ink hover:bg-white/40'
              }`}
            >
              Audit
            </button>
            <button
              onClick={() => setIsSidebarCollapsed(true)}
              className="px-3 py-3 text-xs text-muted hover:text-ink hover:bg-white/40 transition-colors"
              title="Collapse sidebar"
            >
              &lsaquo;
            </button>
          </div>

          {/* Sidebar content — each panel owns its own scroll */}
          <div className="flex-1 overflow-hidden">
            {sidebarTab === 'annotations' ? (
              <AnnotationPanel />
            ) : sidebarTab === 'changes' ? (
              <ChangesPanel />
            ) : sidebarTab === 'history' ? (
              <HistoryPanel />
            ) : sidebarTab === 'audit' ? (
              <AuditLogViewer />
            ) : (
              <DocumentHubSidebar />
            )}
          </div>
        </div>
        ) : (
          <div className="w-12 border-r border-border/70 panel-shell flex items-start justify-center py-4 shrink-0">
            <button
              onClick={() => setIsSidebarCollapsed(false)}
              className="w-8 h-8 rounded-full border border-border/70 text-muted hover:text-ink hover:bg-white/70 transition-colors"
              title="Expand sidebar"
            >
              &rsaquo;
            </button>
          </div>
        )}

        {/* Center: Editor */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Editor toolbar */}
          <div className="topbar-shell flex items-center justify-between px-6 py-3">
            <div className="flex items-center gap-3">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="font-serif text-xl tracking-tight">Intent IDE</h1>
                  <span className="status-chip px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-[0.18em]">
                    Review Studio
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Read, challenge, refine, and approve grouped AI changes.
                </p>
              </div>
              {activeDocumentId && (
                <div className="status-chip px-3 py-2 rounded-xl">
                  <p className="text-sm font-medium text-ink">{activeDocumentTitle}</p>
                  <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                    {isDirty ? 'Unsaved changes' : lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}` : 'Saved'}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowDocInput(true)}
                className="px-3 py-2 text-xs font-medium bg-ink text-white rounded-lg hover:bg-ink/85 transition-colors shadow-sm"
              >
                New Document
              </button>
              <button
                onClick={() => setShowAgentConfig(true)}
                className="px-3 py-2 text-xs font-medium border border-border/70 rounded-lg bg-white/60 hover:bg-white transition-colors"
              >
                Agent Config
              </button>
              <button
                onClick={() => useSettingsStore.getState().setShowApiKeyModal(true)}
                className="px-3 py-2 text-xs font-medium border border-border/70 rounded-lg bg-white/60 hover:bg-white transition-colors"
              >
                API Keys
              </button>
            </div>
          </div>

          {/* Editor area */}
          <div className="flex-1 overflow-y-auto editor-scroll-container editor-stage">
            <div className="max-w-5xl mx-auto px-8 py-8">
              <div className="editor-paper rounded-[28px] px-10 py-8">
                <EditorShell />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Status bar */}
      <StatusBar />

      {/* Voice button (fixed) */}
      <VoiceButton />

      {/* Overlays */}
      {isRecording && <VoiceOverlay />}
      {showApiKeyModal && <ApiKeyModal />}
      {showAgentConfig && <AgentConfigPanel onClose={() => setShowAgentConfig(false)} />}
      {showDocInput && <DocInputModal onClose={() => setShowDocInput(false)} />}
      {showCommandPalette && <CommandPalette onClose={() => setShowCommandPalette(false)} />}
      <FloatingIconBar />

      {/* Toast notifications */}
      <ToastContainer />
    </div>
  )
}
