'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useEditorStore } from '@/stores/editorStore'
import { useConflictStore } from '@/stores/conflictStore'
import { toggleVoiceCapture } from '@/lib/voice/pipeline'
import { runImpactAnalysis } from '@/lib/ai/impactAnalysis'
import { clearAllConflictDecorations } from '@/lib/prosemirror/plugins/conflictPlugin'
import type { Command } from '@/lib/utils/commands'

type PaletteMode = 'commands' | 'intent-input'

interface CommandPaletteProps {
  onClose: () => void
}

export function CommandPalette({ onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [mode, setMode] = useState<PaletteMode>('commands')
  const [intentAction, setIntentAction] = useState<'check' | 'make-change'>('check')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  const handleImpactAnalysis = useCallback(
    async (intent: string, withRewrites: boolean) => {
      const view = useEditorStore.getState().view
      if (!view || !intent.trim()) return

      const settings = useSettingsStore.getState()
      if (settings.llmConfig.provider !== 'ollama' && !settings.llmConfig.apiKey) {
        settings.setShowApiKeyModal(true)
        return
      }

      setIsAnalyzing(true)
      try {
        const count = await runImpactAnalysis(view, intent, withRewrites)
        onClose()
        window.dispatchEvent(
          new CustomEvent('intent-ide:toast', {
            detail: count > 0
              ? `Found ${count} conflict${count !== 1 ? 's' : ''}`
              : 'No conflicts found',
          })
        )
      } catch (err) {
        onClose()
        window.dispatchEvent(
          new CustomEvent('intent-ide:toast', {
            detail: `Analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          })
        )
      } finally {
        setIsAnalyzing(false)
      }
    },
    [onClose]
  )

  const commands: Command[] = useMemo(
    () => [
      {
        id: 'check-conflicts',
        label: 'Check for Conflicts',
        handler: () => {
          setMode('intent-input')
          setIntentAction('check')
          setQuery('')
        },
      },
      {
        id: 'make-change',
        label: 'Make Change (with rewrites)',
        handler: () => {
          setMode('intent-input')
          setIntentAction('make-change')
          setQuery('')
        },
      },
      {
        id: 'clear-conflicts',
        label: 'Clear All Conflicts',
        handler: () => {
          const view = useEditorStore.getState().view
          if (view) {
            clearAllConflictDecorations(view)
            useConflictStore.getState().clearAll()
          }
          onClose()
        },
      },
      {
        id: 'new-doc',
        label: 'New Document',
        handler: () => {
          onClose()
          window.dispatchEvent(new CustomEvent('intent-ide:new-doc'))
        },
      },
      {
        id: 'api-keys',
        label: 'API Keys',
        handler: () => {
          onClose()
          useSettingsStore.getState().setShowApiKeyModal(true)
        },
      },
      {
        id: 'voice',
        label: 'Start/Stop Recording',
        hotkey: 'Ctrl+Space',
        handler: () => {
          onClose()
          const settings = useSettingsStore.getState()
          if (
            settings.llmConfig.provider === 'ollama' ||
            settings.llmConfig.apiKey
          ) {
            toggleVoiceCapture()
          } else {
            settings.setShowApiKeyModal(true)
          }
        },
      },
      {
        id: 'show-annotations',
        label: 'Show Annotations',
        handler: () => {
          onClose()
          window.dispatchEvent(
            new CustomEvent('intent-ide:sidebar', { detail: 'annotations' })
          )
        },
      },
      {
        id: 'show-changes',
        label: 'Show Changes',
        handler: () => {
          onClose()
          window.dispatchEvent(
            new CustomEvent('intent-ide:sidebar', { detail: 'changes' })
          )
        },
      },
      {
        id: 'show-documents',
        label: 'Show Documents',
        handler: () => {
          onClose()
          window.dispatchEvent(
            new CustomEvent('intent-ide:sidebar', { detail: 'documents' })
          )
        },
      },
    ],
    [onClose]
  )

  const filtered = useMemo(() => {
    if (!query.trim()) return commands
    const lower = query.toLowerCase()
    return commands.filter((c) => c.label.toLowerCase().includes(lower))
  }, [commands, query])

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Keep selectedIndex in bounds
  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1))
    }
  }, [filtered.length, selectedIndex])

  const runCommand = useCallback(
    (cmd: Command) => {
      cmd.handler()
    },
    []
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (mode === 'intent-input') {
          setMode('commands')
          setQuery('')
        } else {
          onClose()
        }
      } else if (mode === 'intent-input') {
        if (e.key === 'Enter' && !isAnalyzing) {
          e.preventDefault()
          handleImpactAnalysis(query, intentAction === 'make-change')
        }
      } else {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSelectedIndex((i) => Math.max(i - 1, 0))
        } else if (e.key === 'Enter') {
          e.preventDefault()
          if (filtered[selectedIndex]) {
            runCommand(filtered[selectedIndex])
          }
        }
      }
    },
    [filtered, selectedIndex, onClose, runCommand, mode, query, isAnalyzing, intentAction, handleImpactAnalysis]
  )

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/20"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose()
      }}
    >
      <div
        className="bg-white border border-border rounded-lg shadow-xl w-full max-w-md overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        {mode === 'intent-input' ? (
          <>
            {/* Intent input mode */}
            <div className="px-4 py-3 border-b border-border">
              <div className="text-[10px] font-mono text-muted mb-1.5">
                {intentAction === 'check' ? 'Check for Conflicts' : 'Make Change'}
                {' '}&mdash; describe your intent:
              </div>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. Change the budget from $50k to $75k..."
                className="w-full text-sm outline-none bg-transparent"
                disabled={isAnalyzing}
              />
            </div>
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-xs text-muted">
                {isAnalyzing ? 'Analyzing document...' : 'Press Enter to analyze, Esc to go back'}
              </span>
              {isAnalyzing && (
                <span className="text-xs text-accent font-mono animate-pulse">
                  working...
                </span>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Search input */}
            <div className="px-4 py-3 border-b border-border">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSelectedIndex(0)
                }}
                placeholder="Type a command..."
                className="w-full text-sm outline-none bg-transparent"
              />
            </div>

            {/* Command list */}
            <div className="max-h-64 overflow-y-auto py-1">
              {filtered.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-muted">
                  No matching commands
                </div>
              )}
              {filtered.map((cmd, i) => (
                <button
                  key={cmd.id}
                  onClick={() => runCommand(cmd)}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-sm text-left transition-colors ${
                    i === selectedIndex
                      ? 'bg-accent/10 text-accent'
                      : 'text-ink hover:bg-warm/60'
                  }`}
                >
                  <span>{cmd.label}</span>
                  {cmd.hotkey && (
                    <span className="text-[10px] font-mono text-muted bg-warm px-1.5 py-0.5 rounded">
                      {cmd.hotkey}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
