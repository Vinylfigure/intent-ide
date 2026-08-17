'use client'

import { useMemo, useState, useCallback, useEffect } from 'react'
import { Streamdown, type DiagramPlugin } from 'streamdown'
import { AnnotationComposer } from '@/components/Annotations/AnnotationComposer'
import { extractMermaidFence } from '@/lib/ai/mermaidGuard'
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
    /** Preset intent from a one-click action — skip the classify round-trip. */
    skipClassify?: boolean
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

/**
 * Split markdown body into paragraph-level blocks for drill targets.
 * Fence-aware: blank lines INSIDE a ``` / ~~~ code fence never split, so a
 * mermaid diagram (or any code block) with internal blank lines stays one
 * block; an unterminated fence swallows the rest of the body as one block.
 */
function splitIntoBlocks(body: string): string[] {
  const blocks: string[] = []
  let current: string[] = []
  let inFence = false

  const flush = () => {
    const text = current.join('\n').trim()
    if (text) blocks.push(text)
    current = []
  }

  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      current.push(line)
      continue
    }
    if (!inFence && /^\s*$/.test(line)) {
      // Blank-line run outside a fence → block boundary (empties are filtered).
      flush()
      continue
    }
    current.push(line)
  }
  flush()
  return blocks
}

/**
 * Lazily load the @streamdown/mermaid plugin only when the body actually
 * carries a mermaid fence — the mermaid bundle is heavy and most answers
 * never need it.
 *
 * innerHTML constraint note: mermaid renders its diagrams by writing SVG via
 * its own internal innerHTML. This is the SANCTIONED exception to the
 * project's no-innerHTML rule — the library runs with securityLevel:'strict'
 * (below), which sanitizes the diagram source and disables script/click
 * payloads, and no project code touches innerHTML directly.
 */
function useMermaidPlugin(body: string, isStreaming: boolean): DiagramPlugin | undefined {
  const hasMermaid = useMemo(() => extractMermaidFence(body) !== null, [body])
  const [plugin, setPlugin] = useState<DiagramPlugin | null>(null)

  useEffect(() => {
    if (!hasMermaid || plugin) return
    let cancelled = false
    import('@streamdown/mermaid')
      .then((mod) => {
        if (cancelled) return
        setPlugin(
          mod.createMermaidPlugin({
            config: { startOnLoad: false, securityLevel: 'strict' },
          }),
        )
      })
      .catch(() => {
        // Plugin unavailable — fences render as plain code blocks.
      })
    return () => {
      cancelled = true
    }
  }, [hasMermaid, plugin])

  // While streaming, never attempt a diagram: partial fences must render as
  // plain code until the stream completes.
  if (isStreaming || !hasMermaid || !plugin) return undefined
  return plugin
}

export function AgentMarkdown({ content, isStreaming = false, interactive = false, onDrill }: AgentMarkdownProps) {
  const { reasoning, debateLog, body } = useMemo(() => extractBlocks(content), [content])
  const blocks = useMemo(() => interactive ? splitIntoBlocks(body) : [], [body, interactive])
  const [composer, setComposer] = useState<{ x: number; y: number; blockText: string } | null>(null)
  const mermaidPlugin = useMermaidPlugin(body, isStreaming)
  const plugins = mermaidPlugin ? { mermaid: mermaidPlugin } : undefined

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
            <Streamdown mode="static" remend={{}} plugins={plugins}>
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
          plugins={plugins}
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
              onSubmit={async ({ text, suggestedIntent, skipClassify }) => {
                onDrill?.({
                  blockText: composer.blockText,
                  transcript: text,
                  suggestedIntent,
                  skipClassify,
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
