'use client'

interface DiffViewProps {
  before: string
  after: string
}

function NumberedLines({ text, prefix, lineClass, prefixClass }: {
  text: string
  prefix: string
  lineClass: string
  prefixClass: string
}) {
  const lines = text.split('\n')
  return (
    <div className="font-mono text-xs">
      {lines.map((line, i) => (
        <div key={i} className={`flex gap-2 px-2.5 py-0.5 ${lineClass}`}>
          <span className="text-muted-foreground/30 select-none w-5 text-right shrink-0">{i + 1}</span>
          <span className={`${prefixClass} shrink-0 select-none`}>{prefix}</span>
          <span className={prefixClass}>{line || ' '}</span>
        </div>
      ))}
    </div>
  )
}

export function DiffView({ before, after }: DiffViewProps) {
  return (
    <div className="rounded-xl border border-border/70 overflow-hidden bg-white">
      {before && (
        <div className="bg-red-50/60 border-b border-border/50">
          <NumberedLines
            text={before}
            prefix="-"
            lineClass=""
            prefixClass="text-red-500/70"
          />
        </div>
      )}
      {after && (
        <div className="bg-emerald-50/60">
          <NumberedLines
            text={after}
            prefix="+"
            lineClass=""
            prefixClass="text-emerald-600/70"
          />
        </div>
      )}
    </div>
  )
}
