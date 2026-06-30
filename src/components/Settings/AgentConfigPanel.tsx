'use client'

import { useState } from 'react'
import {
  useAgentConfigStore,
  DEFAULT_CONFIGS,
  type CustomAnnotationType,
} from '@/stores/agentConfigStore'
import type { AnnotationType } from '@/lib/annotations/types'
import { ANNOTATION_LABELS } from '@/lib/annotations/types'
import { generateId } from '@/lib/utils/id'

const BUILTIN_TYPES: AnnotationType[] = [
  'ask',
  'edit',
  'dig',
  'flag',
]

const PRESET_COLORS = [
  '#2b5fc4',
  '#c44b2b',
  '#6b4dc4',
  '#b8860b',
  '#2b8c5e',
  '#8b5cf6',
  '#d97706',
  '#dc2626',
  '#059669',
  '#7c3aed',
]

interface AgentConfigPanelProps {
  onClose: () => void
}

export function AgentConfigPanel({ onClose }: AgentConfigPanelProps) {
  const builtinConfigs = useAgentConfigStore((s) => s.builtinConfigs)
  const customTypes = useAgentConfigStore((s) => s.customTypes)
  const setConfig = useAgentConfigStore((s) => s.setConfig)
  const resetConfig = useAgentConfigStore((s) => s.resetConfig)
  const addCustomType = useAgentConfigStore((s) => s.addCustomType)
  const removeCustomType = useAgentConfigStore((s) => s.removeCustomType)
  const updateCustomType = useAgentConfigStore((s) => s.updateCustomType)

  const [section, setSection] = useState<'builtin' | 'custom'>('builtin')
  const [activeType, setActiveType] = useState<AnnotationType>('ask')
  const [editingCustom, setEditingCustom] = useState<string | null>(null)
  const [showNewForm, setShowNewForm] = useState(false)

  // New custom type form state
  const [newLabel, setNewLabel] = useState('')
  const [newColor, setNewColor] = useState(PRESET_COLORS[0])
  const [newInstructions, setNewInstructions] = useState('')

  const activeConfig = builtinConfigs[activeType]

  const handleAddCustom = () => {
    if (!newLabel.trim()) return
    addCustomType({
      id: generateId(),
      label: newLabel.trim(),
      color: newColor,
      agentInstructions: newInstructions,
      actions: [
        { label: 'Accept', kind: 'accept', handler: 'dismiss' },
        { label: 'Dismiss', kind: 'dismiss', handler: 'dismiss' },
      ],
    })
    setNewLabel('')
    setNewColor(PRESET_COLORS[0])
    setNewInstructions('')
    setShowNewForm(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="font-serif text-xl">Agent Configuration</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-ink text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Section tabs */}
        <div className="flex border-b border-border shrink-0">
          <button
            onClick={() => setSection('builtin')}
            className={`flex-1 px-4 py-2.5 text-xs font-mono uppercase tracking-wider transition-colors ${
              section === 'builtin'
                ? 'text-accent border-b-2 border-accent bg-white/50'
                : 'text-muted hover:text-ink'
            }`}
          >
            Built-in Types
          </button>
          <button
            onClick={() => setSection('custom')}
            className={`flex-1 px-4 py-2.5 text-xs font-mono uppercase tracking-wider transition-colors ${
              section === 'custom'
                ? 'text-accent border-b-2 border-accent bg-white/50'
                : 'text-muted hover:text-ink'
            }`}
          >
            Custom Types
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {section === 'builtin' ? (
            <div className="space-y-4">
              {/* Type tabs */}
              <div className="flex flex-wrap gap-1.5">
                {BUILTIN_TYPES.map((type) => (
                  <button
                    key={type}
                    onClick={() => setActiveType(type)}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                      activeType === type
                        ? 'bg-accent text-white'
                        : 'bg-warm text-muted hover:text-ink hover:bg-border'
                    }`}
                  >
                    {ANNOTATION_LABELS[type]}
                  </button>
                ))}
              </div>

              {/* Config for active type */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1.5">
                    Temperature ({activeConfig.temperature})
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={activeConfig.temperature}
                    onChange={(e) =>
                      setConfig(activeType, {
                        temperature: parseFloat(e.target.value),
                      })
                    }
                    className="w-full accent-accent"
                  />
                  <div className="flex justify-between text-xs text-muted mt-1">
                    <span>Precise (0)</span>
                    <span>Creative (1)</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1.5">
                    Max Tokens
                  </label>
                  <input
                    type="number"
                    min={100}
                    max={4000}
                    step={100}
                    value={activeConfig.maxTokens}
                    onChange={(e) =>
                      setConfig(activeType, {
                        maxTokens: parseInt(e.target.value, 10) || 600,
                      })
                    }
                    className="w-full px-3 py-2 text-sm font-mono border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1.5">
                    Custom Instructions
                  </label>
                  <textarea
                    value={activeConfig.customInstructions}
                    onChange={(e) =>
                      setConfig(activeType, {
                        customInstructions: e.target.value,
                      })
                    }
                    placeholder="Additional instructions prepended to the type prompt..."
                    rows={3}
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent resize-y"
                  />
                </div>

                <button
                  onClick={() => resetConfig(activeType)}
                  className="px-3 py-1.5 text-xs font-medium border border-border rounded hover:bg-warm transition-colors"
                >
                  Reset to default
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Custom types list */}
              {customTypes.length === 0 && !showNewForm && (
                <p className="text-sm text-muted text-center py-4">
                  No custom annotation types yet.
                </p>
              )}

              {customTypes.map((ct) => (
                <div
                  key={ct.id}
                  className="border border-border rounded-lg p-4 space-y-3"
                >
                  {editingCustom === ct.id ? (
                    <>
                      <input
                        value={ct.label}
                        onChange={(e) =>
                          updateCustomType(ct.id, { label: e.target.value })
                        }
                        className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20"
                        placeholder="Type label"
                      />
                      <div className="flex gap-1.5 flex-wrap">
                        {PRESET_COLORS.map((c) => (
                          <button
                            key={c}
                            onClick={() =>
                              updateCustomType(ct.id, { color: c })
                            }
                            className={`w-6 h-6 rounded-full border-2 transition-colors ${
                              ct.color === c
                                ? 'border-ink scale-110'
                                : 'border-transparent'
                            }`}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                      <textarea
                        value={ct.agentInstructions}
                        onChange={(e) =>
                          updateCustomType(ct.id, {
                            agentInstructions: e.target.value,
                          })
                        }
                        placeholder="Agent instructions for this type..."
                        rows={3}
                        className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 resize-y"
                      />
                      <button
                        onClick={() => setEditingCustom(null)}
                        className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded hover:bg-accent/80 transition-colors"
                      >
                        Done
                      </button>
                    </>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: ct.color }}
                        />
                        <span className="text-sm font-medium">{ct.label}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setEditingCustom(ct.id)}
                          className="px-2 py-1 text-xs text-muted hover:text-ink transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => removeCustomType(ct.id)}
                          className="px-2 py-1 text-xs text-red-500 hover:text-red-700 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* New custom type form */}
              {showNewForm ? (
                <div className="border border-accent/30 rounded-lg p-4 space-y-3 bg-accent/5">
                  <input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="Type label (e.g. Fact-Check)"
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20"
                  />
                  <div>
                    <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1.5">
                      Color
                    </label>
                    <div className="flex gap-1.5 flex-wrap">
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => setNewColor(c)}
                          className={`w-6 h-6 rounded-full border-2 transition-colors ${
                            newColor === c
                              ? 'border-ink scale-110'
                              : 'border-transparent'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                  <textarea
                    value={newInstructions}
                    onChange={(e) => setNewInstructions(e.target.value)}
                    placeholder="Agent instructions for this type..."
                    rows={3}
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 resize-y"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleAddCustom}
                      className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded hover:bg-accent/80 transition-colors"
                    >
                      Add Type
                    </button>
                    <button
                      onClick={() => setShowNewForm(false)}
                      className="px-3 py-1.5 text-xs font-medium border border-border rounded hover:bg-warm transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowNewForm(true)}
                  className="w-full px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/80 transition-colors"
                >
                  Add Custom Type
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
