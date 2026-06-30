'use client'

// The read-line is rendered as a ProseMirror widget decoration by readLinePlugin
// This component provides a legend/info display
export function ReadLineIndicator() {
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <div className="w-4 h-0.5 bg-accent/30 rounded" />
      <span>Reading position</span>
    </div>
  )
}
