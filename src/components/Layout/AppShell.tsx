'use client'

import { useState, useEffect } from 'react'
import { EditorShell } from '@/components/Editor/EditorShell'
import { AnnotationPanel } from '@/components/Annotations/AnnotationPanel'
import { FloatingAnswer } from '@/components/Annotations/FloatingAnswer'
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
import { useLayoutStore, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH } from '@/stores/layoutStore'
import { useEditorStore } from '@/stores/editorStore'
import { useVoiceStore } from '@/stores/voiceStore'
import { useDocumentStore } from '@/stores/documentStore'
import { initHotkeyListener, registerHotkey } from '@/lib/utils/hotkeys'
import { toggleVoiceCapture } from '@/lib/voice/pipeline'
import { triggerFloatingBar } from '@/lib/prosemirror/plugins/contextMenuPlugin'

type SidebarTab = 'annotations' | 'changes' | 'documents' | 'history' | 'audit'

/**
 * Sidebar tabs, split by how they are used rather than alphabetically.
 *
 * The rail is a fixed 320px. Five equal tabs left each label about 55px, which
 * is why they were set at 10px with wide tracking and still read poorly. The
 * three workspaces people live in keep the rail; History and Audit are
 * reference surfaces consulted occasionally, so they move behind an overflow
 * menu that names whichever of them is active.
 */
const PRIMARY_TABS: { id: SidebarTab; label: string }[] = [
  { id: 'annotations', label: 'Annotations' },
  { id: 'changes', label: 'Changes' },
  { id: 'documents', label: 'Documents' },
]

const OVERFLOW_TABS: { id: SidebarTab; label: string }[] = [
  { id: 'history', label: 'History' },
  { id: 'audit', label: 'Audit' },
]

const SIDEBAR_TABS = [...PRIMARY_TABS, ...OVERFLOW_TABS]

const SIDEBAR_TAB_IDS = new Set<string>(SIDEBAR_TABS.map((tab) => tab.id))

export function AppShell() {
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('annotations')
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [showTabOverflow, setShowTabOverflow] = useState(false)
  const [showDocInput, setShowDocInput] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showAgentConfig, setShowAgentConfig] = useState(false)
  const showApiKeyModal = useSettingsStore((s) => s.showApiKeyModal)
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth)
  const setSidebarWidth = useLayoutStore((s) => s.setSidebarWidth)

  // Drag-to-resize: pointer capture keeps move events on the handle even when
  // the cursor leaves it; the store clamps every value, so drags can't strand
  // the rail. Width persists via the layout store.
  const startSidebarResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const handle = e.currentTarget
    const startX = e.clientX
    const startWidth = useLayoutStore.getState().sidebarWidth
    handle.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => {
      useLayoutStore.getState().setSidebarWidth(startWidth + (ev.clientX - startX))
    }
    const stop = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  }
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

  // Overflow menu: dismiss on outside click or Escape, like every other
  // transient surface in the app.
  useEffect(() => {
    if (!showTabOverflow) return
    function handlePointerDown(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('[data-tab-overflow]')) {
        setShowTabOverflow(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowTabOverflow(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showTabOverflow])

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
      if (typeof detail === 'string' && SIDEBAR_TAB_IDS.has(detail)) {
        setSidebarTab(detail as SidebarTab)
        setIsSidebarCollapsed(false)
        setShowTabOverflow(false)
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

  const overflowTab = OVERFLOW_TABS.find((tab) => tab.id === sidebarTab) ?? null

  return (
    <div className="flex flex-col h-screen app-shell-backdrop">
      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — width lives in layoutStore (drag the right edge, or
            arrow keys on the focused handle) and persists across sessions */}
        {!isSidebarCollapsed ? (
        <div className="relative shrink-0" style={{ width: sidebarWidth }}>
        <div className="h-full border-r border-border/70 panel-shell flex flex-col">
          {/* Sidebar tabs */}
          <div className="flex items-center border-b border-border/70 bg-white/55">
            {PRIMARY_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSidebarTab(tab.id)}
                aria-current={sidebarTab === tab.id ? 'page' : undefined}
                className={`flex-1 px-3 py-3 text-[11px] font-mono uppercase tracking-[0.12em] transition-colors ${
                  sidebarTab === tab.id
                    ? 'text-accent border-b-2 border-accent bg-white/80'
                    : 'text-muted-foreground hover:text-ink hover:bg-white/40'
                }`}
              >
                {tab.label}
              </button>
            ))}

            {/* History + Audit. The trigger takes the active tab's name when
                one of them is showing, so the rail never hides where you are. */}
            <div className="relative" data-tab-overflow>
              <button
                onClick={() => setShowTabOverflow((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={showTabOverflow}
                aria-label={overflowTab ? `${overflowTab.label} — more panels` : 'More panels'}
                title="History and Audit"
                className={`px-3 py-3 text-[11px] font-mono uppercase tracking-[0.12em] transition-colors ${
                  overflowTab
                    ? 'text-accent border-b-2 border-accent bg-white/80'
                    : 'text-muted-foreground hover:text-ink hover:bg-white/40'
                }`}
              >
                {overflowTab ? overflowTab.label : '\u22EF'}
              </button>
              {showTabOverflow && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-30 mt-1 min-w-[10rem] rounded-xl border border-border/70 bg-white py-1 shadow-lg"
                >
                  {OVERFLOW_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      role="menuitem"
                      onClick={() => {
                        setSidebarTab(tab.id)
                        setShowTabOverflow(false)
                      }}
                      className={`flex w-full items-center px-3 py-2 text-left text-xs transition-colors hover:bg-warm ${
                        sidebarTab === tab.id ? 'font-semibold text-accent' : 'text-ink'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => setIsSidebarCollapsed(true)}
              aria-label="Collapse sidebar"
              aria-expanded={true}
              className="px-3 py-3 text-xs text-muted-foreground hover:text-ink hover:bg-white/40 transition-colors"
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

        {/* Resize handle */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          title="Drag to resize the sidebar"
          onPointerDown={startSidebarResize}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault()
              setSidebarWidth(sidebarWidth + (e.key === 'ArrowRight' ? 16 : -16))
            }
          }}
          className="absolute -right-1 top-0 z-20 h-full w-2 cursor-col-resize rounded-full transition-colors hover:bg-accent/30 focus-visible:bg-accent/30 focus-visible:outline-none"
        />
        </div>
        ) : (
          <div className="w-12 border-r border-border/70 panel-shell flex items-start justify-center py-4 shrink-0">
            <button
              onClick={() => setIsSidebarCollapsed(false)}
              aria-label="Expand sidebar"
              aria-expanded={false}
              className="w-8 h-8 rounded-full border border-border/70 text-muted-foreground hover:text-ink hover:bg-white/70 transition-colors"
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
      <FloatingAnswer />

      {/* Toast notifications */}
      <ToastContainer />
    </div>
  )
}
