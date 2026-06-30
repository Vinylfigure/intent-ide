'use client'

type ProgressStage = 'classifying' | 'analyzing' | 'streaming'

interface ResolutionProgressProps {
  stage: ProgressStage
}

const STAGE_LABELS: Record<ProgressStage, string> = {
  classifying: 'Understanding your intent...',
  analyzing: 'Analyzing context...',
  streaming: 'Writing response...',
}

const STAGE_ORDER: ProgressStage[] = ['classifying', 'analyzing', 'streaming']

export function ResolutionProgress({ stage }: ResolutionProgressProps) {
  const currentIndex = STAGE_ORDER.indexOf(stage)
  const progress = ((currentIndex + 1) / STAGE_ORDER.length) * 100

  return (
    <div className="mt-2">
      {/* Progress bar */}
      <div className="h-1 bg-border rounded-full overflow-hidden mb-2">
        <div
          className="h-full bg-accent rounded-full transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      {/* Stage label */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
        {STAGE_LABELS[stage]}
      </div>
    </div>
  )
}
