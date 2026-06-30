'use client'

import { useSettingsStore } from '@/stores/settingsStore'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useChangesStore } from '@/stores/changesStore'

export function StatusBar() {
  const provider = useSettingsStore((s) => s.llmConfig.provider)
  const model = useSettingsStore((s) => s.llmConfig.model)
  const hasKeys = useSettingsStore((s) => s.llmConfig.apiKey.length > 0)
  const annotationCount = useAnnotationStore((s) => s.annotations.length)
  const changeSetCount = useChangesStore((s) => s.changeSets.length)
  const changeCount = useChangesStore((s) => s.entries.filter((e) => !e.undone).length)

  return (
    <div className="flex items-center justify-between px-4 py-2 border-t border-border/70 bg-white/70 backdrop-blur-sm text-xs font-mono text-muted">
      <div className="flex items-center gap-4">
        <span className="status-chip px-2.5 py-1 rounded-full">{annotationCount} annotations</span>
        <span className="status-chip px-2.5 py-1 rounded-full">{changeSetCount} change sets</span>
        <span className="status-chip px-2.5 py-1 rounded-full">{changeCount} changes</span>
      </div>
      <div className="flex items-center gap-4">
        <span className={`status-chip px-2.5 py-1 rounded-full ${hasKeys ? 'text-annotation-correction' : 'text-accent'}`}>
          {hasKeys ? `${provider} · ${model}` : 'No API key set'}
        </span>
        <span className="status-chip px-2.5 py-1 rounded-full">Voice: Ctrl+Space</span>
      </div>
    </div>
  )
}
