'use client'

import { useMemo, useState, useCallback } from 'react'
import { Streamdown } from 'streamdown'
import { AnnotationComposer } from '@/components/Annotations/AnnotationComposer'
import type { AnnotationType } from '@/lib/annotations/types'

interface AgentMarkdownProps {
  content: string
  isStreaming?: boolean
  /** When true, paragraphs/list-items/headings become clickable drill targets */
  interactive?: boolean
  /** Called when user clicks a block and selects a drill action */
  onDrill?: (payload: {
    blockText: string
    transcript: string
    suggestedIntent: AnnotationType | null
  }) => void
}

interface ExtractedContent {
  reasoning: string | null
  debateLog: string | null
  body: string
}

function extractBlocks(content: string): ExtractedContent {
  let body = content
  let reasoning: string | null = null
  let debateLog: string | null = null

  // Extract <chain-of-thought> debate log
  const cotMatch = body.match(/<chain-of-thought>([\s\S]*?)<\/chain-of-thought>/i)
  if (cotMatch) {
    debateLog = cotMatch[1].trim()
    body = body.replace(cotMatch[0], '').trim()
  }

  // Extract <thinking> reasoning
  const thinkingMatch = body.match(/<thinking>([\s\S]*?)<\/thinking>/i)
  if (thinkingMatch) {
    reasoning = thinkingMatch[1].trim()
    body = body.replace(thinkingMatch[0], '').trim()
  }

  // Extract REASONING: prefix
  if (!reasoning) {
    const reasoningMatch = body.match(/^REASONING:\s*([\s\S]*?)(?:\n\n|$)/i)
    if (reasoningMatch) {
      reasoning = reasoningMatch[1].trim()
      body = body.slice(reasoningMatch[0].length).trim()
    }
  }

  return { reasoning, debateLog, body }
}

/** Split markdown body into paragraph-level blocks for drill targets */
function splitIntoBlocks(body: string): string[] {
  // Split on double newlines (paragraph boundaries), filter empties
  return body.split(/\n{2,}/).map(b => b.trim()).filter(Boolean)
}

export function AgentMarkdown({ content, isStreaming = false, interactive = false, onDrill }: AgentMarkdownProps) {
  const { reasoning, debateLog, body } = useMemo(() => extractBlocks(content), [content])
  const blocks = useMemo(() => interactive ? splitIntoBlocks(body) : [], [body, interactive])
  const [composer, setComposer] = useState<{ x: number; y: number; blockText: string } | null>(null)

  const handleBlockClick = useCallback((e: React.MouseEvent, blockText: string) => {
    if (!interactive || !onDrill) return
    e.stopPropagation()
    setComposer({ x: e.clientX, y: e.clientY, blockText })
  }, [interactive, onDrill])

  return (
    <div className="agent-markdown">
      {reasoning && (
        <details className="agent-reasoning">
          <summary>Reasoning</summary>
          <div className="reasoning-content">
            <Streamdown mode="static" remend={{}}>
              {reasoning}
            </Streamdown>
          </div>
        </details>
      )}
      {interactive && blocks.length > 0 ? (
        // Render each block as a clickable drill target
        blocks.map((block, i) => (
          <div
            key={i}
            onClick={(e) => handleBlockClick(e, block)}
            className="cursor-pointer rounded px-1 -mx-1 transition-colors hover:bg-accent/5 relative group"
          >
            <Streamdown mode="static" remend={{}}>
              {block}
            </Streamdown>
            <span className="absolute right-0 top-1 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-mono text-muted-foreground bg-white/80 px-1 rounded">
              click to drill
            </span>
          </div>
        ))
      ) : (
        <Streamdown
          mode={isStreaming ? 'streaming' : 'static'}
          remend={{}}
        >
          {body}
        </Streamdown>
      )}
      {debateLog && (
        <details className="mt-3 border border-border rounded-md overflow-hidden">
          <summary className="px-3 py-2 text-xs font-mono text-muted-foreground cursor-pointer select-none hover:bg-warm/50 transition-colors">
            View AI Reasoning...
          </summary>
          <div className="px-3 py-2 border-t border-border bg-warm/30 text-xs leading-relaxed text-muted-foreground">
            <Streamdown mode="static" remend={{}}>
              {debateLog}
            </Streamdown>
          </div>
        </details>
      )}
      {composer && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setComposer(null)} />
          <div
            className="fixed z-50"
            style={{
              left: Math.min(composer.x, window.innerWidth - 380),
              top: Math.min(composer.y, window.innerHeight - 140),
            }}
          >
            <AnnotationComposer
              mode="thread"
              className="w-[360px]"
              suggestedIntent="dig"
              onSubmit={async ({ text, suggestedIntent }) => {
                onDrill?.({
                  blockText: composer.blockText,
                  transcript: text,
                  suggestedIntent,
                })
                setComposer(null)
              }}
              onCancel={() => setComposer(null)}
            />
          </div>
        </>
      )}
    </div>
  )
}
