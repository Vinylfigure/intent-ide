'use client'

import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { Streamdown, type DiagramPlugin } from 'streamdown'
import { AnnotationComposer } from '@/components/Annotations/AnnotationComposer'
import { extractMermaidFence } from '@/lib/ai/mermaidGuard'
import { inferScopeFromText } from '@/lib/annotations/selectionOffers'
import type { AnnotationType } from '@/lib/annotations/types'

interface AgentMarkdownProps {
  content: string
  isStreaming?: boolean
  /** When true, drag-selecting text inside the answer opens a drill composer */
  interactive?: boolean
  /** Called when the user drag-selects answer text and submits a drill action */
  onDrill?: (payload: {
    /** @deprecated kept alongside `quote` for callers not yet migrated — always equal to `quote`. */
    blockText: string
    /** The exact highlighted answer text the sub-chat was spun off from. */
    quote: string
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
  const [composer, setComposer] = useState<{ x: number; y: number; text: string } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const mermaidPlugin = useMermaidPlugin(body, isStreaming)
  const plugins = mermaidPlugin ? { mermaid: mermaidPlugin } : undefined

  const handleMouseUp = useCallback((event: React.MouseEvent) => {
    if (!interactive || !onDrill) return
    // The composer renders INSIDE this container, so a click on one of its
    // buttons also bubbles a mouseup to here — and by then the mousedown has
    // already collapsed the selection. Without this guard the handler tears
    // the composer down before the button's own onClick can fire, which makes
    // every control in it silently dead to the mouse.
    if (composerRef.current?.contains(event.target as Node)) return
    const container = containerRef.current
    const selection = window.getSelection()
    if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) {
      setComposer(null)
      return
    }
    const range = selection.getRangeAt(0)
    const text = selection.toString()
    // Empty (whitespace-only) selection, or a selection whose common
    // ancestor falls outside this answer's own container — never open here.
    if (!text.trim() || !container.contains(range.commonAncestorContainer)) {
      setComposer(null)
      return
    }
    const rect = range.getBoundingClientRect()
    setComposer({ x: rect.left, y: rect.bottom, text })
  }, [interactive, onDrill])

  // Not a fresh object literal at the JSX call site, so AnnotationComposer's
  // (narrower, mid-upgrade) selectionAnchor prop type doesn't trigger excess
  // property checking against the extra `scope` field it doesn't declare yet.
  const selectionAnchor = composer
    ? { from: 0, to: 0, text: composer.text, scope: inferScopeFromText(composer.text) }
    : undefined

  return (
    <div className="agent-markdown" ref={containerRef} onMouseUp={interactive && onDrill ? handleMouseUp : undefined}>
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
      <Streamdown
        mode={isStreaming ? 'streaming' : 'static'}
        remend={{}}
        plugins={plugins}
      >
        {body}
      </Streamdown>
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
            ref={composerRef}
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
              selectionAnchor={selectionAnchor}
              onSubmit={async ({ text, suggestedIntent, skipClassify }) => {
                onDrill?.({
                  blockText: composer.text,
                  quote: composer.text,
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
