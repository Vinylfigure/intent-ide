'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AnnotationType } from '@/lib/annotations/types'

export interface AgentConfig {
  temperature: number
  maxTokens: number
  customInstructions: string
}

export interface CustomAnnotationType {
  id: string
  label: string
  color: string
  agentInstructions: string
  actions: { label: string; kind: 'apply' | 'accept' | 'deepen' | 'dismiss'; handler: string }[]
}

const DEFAULT_CONFIGS: Record<AnnotationType, AgentConfig> = {
  ask: { temperature: 0.5, maxTokens: 400, customInstructions: '' },
  edit: { temperature: 0.2, maxTokens: 400, customInstructions: '' },
  dig: { temperature: 0.7, maxTokens: 500, customInstructions: '' },
  flag: { temperature: 0.6, maxTokens: 400, customInstructions: '' },
}

interface AgentConfigState {
  builtinConfigs: Record<AnnotationType, AgentConfig>
  customTypes: CustomAnnotationType[]
  getConfig: (type: AnnotationType) => AgentConfig
  setConfig: (type: AnnotationType, config: Partial<AgentConfig>) => void
  resetConfig: (type: AnnotationType) => void
  addCustomType: (type: CustomAnnotationType) => void
  removeCustomType: (id: string) => void
  updateCustomType: (id: string, patch: Partial<CustomAnnotationType>) => void
}

export const useAgentConfigStore = create<AgentConfigState>()(
  persist(
    (set, get) => ({
      builtinConfigs: { ...DEFAULT_CONFIGS },
      customTypes: [],
      getConfig: (type) => {
        const configs = get().builtinConfigs
        return configs[type] ?? DEFAULT_CONFIGS.flag
      },
      setConfig: (type, config) =>
        set((s) => ({
          builtinConfigs: {
            ...s.builtinConfigs,
            [type]: { ...s.builtinConfigs[type], ...config },
          },
        })),
      resetConfig: (type) =>
        set((s) => ({
          builtinConfigs: {
            ...s.builtinConfigs,
            [type]: { ...DEFAULT_CONFIGS[type] },
          },
        })),
      addCustomType: (type) =>
        set((s) => ({ customTypes: [...s.customTypes, type] })),
      removeCustomType: (id) =>
        set((s) => ({ customTypes: s.customTypes.filter((t) => t.id !== id) })),
      updateCustomType: (id, patch) =>
        set((s) => ({
          customTypes: s.customTypes.map((t) =>
            t.id === id ? { ...t, ...patch } : t
          ),
        })),
    }),
    { name: 'intent-ide-agent-config' }
  )
)

export { DEFAULT_CONFIGS }
