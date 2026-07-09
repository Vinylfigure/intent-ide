import { EditorState } from 'prosemirror-state'
import { RESOLVER_SYSTEM_PROMPT, TYPE_PROMPTS, CONTEXT_COMPRESSION_PROMPT } from './prompts'
import { useSettingsStore, type LLMConfig } from '@/stores/settingsStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useAgentConfigStore } from '@/stores/agentConfigStore'
import { useAnnotationStore } from '@/stores/annotationStore'
import { useChangesStore } from '@/stores/changesStore'
import { getBlockText, getSectionText } from '@/lib/prosemirror/helpers'
import { runMADS } from './mads'
import { logResolutionAudit } from '@/lib/audit/auditLogger'
import { primaryProposedEdit, proposeCascadeEdits } from './orchestrator'
import { pickUtilityModel } from './modelCapabilities'
import { blockIdAtPos } from '@/lib/prosemirror/blockIds'
import { getDefaultVerbosity } from '@/lib/annotations/types'
import type { Annotation, ConversationMessage, Resolution, ResolutionAction, SuggestedEdit, Scope, Verbosity } from '@/lib/annotations/types'
import { generateId } from '@/lib/utils/id'
import type { LLMMessage } from './client'

// Scope-based token caps — responses proportional to selection size
const SCOPE_TOKEN_LIMITS: Record<Scope, number> = {
  phrase: 150,
  sentence: 250,
  paragraph: 400,
  section: 600,
}

const SCOPE_INSTRUCTIONS: Record<Scope, string> = {
  phrase: '1-2 sentences max, like a dictionary entry',
  sentence: '2-3 sentences max',
  paragraph: '3-4 sentences max, use bullets if needed',
  section: '4-5 sentences max, use bullets if needed',
}

const VERBOSITY_MULTIPLIER: Record<Verbosity, number> = {
  concise: 0.5,
  normal: 1,
  detailed: 2,
}

const VERBOSITY_INSTRUCTIONS: Record<Verbosity, string> = {
  concise: 'Be extremely brief. Cut to the essentials only.',
  normal: '',
  detailed: 'Be thorough and comprehensive. Include evidence, examples, and cross-references.',
}

function resolveAdaptiveVerbosity(annotation: Annotation): Verbosity {
  return annotation.verbosity || getDefaultVerbosity(annotation.anchor.scope, annotation.type)
}

function buildReviewProgress(currentAnnotationId: string): string {
  const annotations = useAnnotationStore.getState().annotations
  const total = annotations.length
  if (total === 0) return ''

  const counts: Record<string, number> = {}
  let currentIndex = 0
  annotations.forEach((a, i) => {
    counts[a.type] = (counts[a.type] || 0) + 1
    if (a.id === currentAnnotationId) currentIndex = i + 1
  })

  const breakdown = Object.entries(counts)
    .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
    .join(', ')

  return `\nREVIEW PROGRESS:\n  Annotations so far: ${total} (${breakdown})\n  This is annotation #${currentIndex} in the review.`
}

// Resolution action definitions per type (4-intent system)
const ACTIONS_BY_TYPE: Record<string, ResolutionAction[]> = {
  ask: [
    { label: 'Got it', kind: 'accept', handler: 'dismiss' },
    { label: 'Go deeper', kind: 'deepen', handler: 'explore' },
    { label: 'Change based on this', kind: 'apply', handler: 'change-from-answer' },
  ],
  edit: [
    { label: 'Apply', kind: 'apply', handler: 'apply-edit' },
    { label: 'Tweak it', kind: 'deepen', handler: 'tweak' },
    { label: 'Show affected', kind: 'deepen', handler: 'show-cascade' },
    { label: 'Nevermind', kind: 'dismiss', handler: 'dismiss' },
  ],
  dig: [
    { label: 'Got it', kind: 'accept', handler: 'dismiss' },
    { label: 'Add to doc', kind: 'apply', handler: 'add-to-doc' },
    { label: 'Keep digging', kind: 'deepen', handler: 'explore-deeper' },
  ],
  flag: [
    { label: 'Keep it', kind: 'accept', handler: 'park' },
    { label: 'Act on this', kind: 'apply', handler: 'act-on-thought' },
    { label: 'Research more', kind: 'deepen', handler: 'research' },
    { label: 'Dismiss', kind: 'dismiss', handler: 'dismiss' },
  ],
}

function parseSuggestedEdit(content: string, annotation: Annotation): SuggestedEdit | null {
  // Look for SUGGESTED EDIT: ... REASON: ... pattern
  const editMatch = content.match(/SUGGESTED EDIT:\s*\n([\s\S]*?)(?:\n\s*REASON:|$)/i)
  const reasonMatch = content.match(/REASON:\s*\n?([\s\S]*?)$/i)

  if (editMatch) {
    return {
      from: annotation.anchor.from,
      to: annotation.anchor.to,
      newText: editMatch[1].trim(),
      reason: reasonMatch ? reasonMatch[1].trim() : '',
    }
  }

  return null
}

/**
 * Populate resolution.edits with the primary edit plus cascade proposals
 * (PRD Read-Line + Cascade). Best-effort: cascade failures leave just the
 * primary edit, never block the resolution.
 */
async function attachCascadeEdits(
  resolution: Resolution,
  editorState: EditorState,
  config: LLMConfig,
  anchorText: string,
): Promise<void> {
  if (!resolution.suggestedEdit) return
  const primaryBlockId =
    blockIdAtPos(editorState.doc, resolution.suggestedEdit.from) ?? undefined
  const primary = primaryProposedEdit(resolution.suggestedEdit, anchorText, primaryBlockId)
  // Graph-scoped: the dependency graph bounds what the model sees, so the old
  // whole-doc-truncated-to-6000-chars payload (which silently hid everything
  // past ~page 4) is gone. Long documents now cascade end to end.
  const cascades = await proposeCascadeEdits(editorState, resolution.suggestedEdit, config)
  resolution.edits = [primary, ...cascades]
}

export async function resolveAnnotation(
  annotation: Annotation,
  editorState: EditorState,
): Promise<Resolution> {
  const config = useSettingsStore.getState().llmConfig
  const sessionContext = useSessionStore.getState().context

  // Context compaction: if session history is large, compress before proceeding
  await maybeCompactContext()

  // Build context
  const localBlock = getBlockText(editorState, annotation.anchor.from)
  const sectionText = getSectionText(editorState, annotation.anchor.from)
  const contextSummary = sessionContext.annotationHistory || 'No prior context.'

  // Try MADS pipeline for complex intents (correction, restructure, ambiguous fixes)
  try {
    const madsResult = await runMADS(annotation, sectionText)
    if (madsResult) {
      // Audit log for MADS resolution (non-blocking)
      logResolutionAudit({
        annotationType: annotation.type,
        transcript: annotation.transcript,
        modelName: config.provider,
        modelVersion: config.model,
        promptVersion: 'MADS_v1',
        responseId: crypto.randomUUID(),
        usedMADS: true,
      }).then((auditId) => {
        if (auditId) {
          madsResult.resolution.auditId = auditId
          useChangesStore.getState().linkAuditToAnnotation(annotation, auditId)
        }
      }).catch((e) => {
        // EU AI Act ledger write failed — surface incomplete coverage, don't drop silently
        console.error('Audit log failed (MADS)', e)
        madsResult.resolution.auditFailed = true
      })
      // Pass MADS uncertainty flags for visualization (Claude fallback)
      if (madsResult.uncertaintyFlags.length > 0) {
        madsResult.resolution.uncertaintyFlags = madsResult.uncertaintyFlags
      }
      // Attach multi-region cascade edits (best-effort)
      await attachCascadeEdits(madsResult.resolution, editorState, config, annotation.anchor.text)
      return madsResult.resolution
    }
  } catch {
    // MADS failed — fall through to single-agent resolution
  }

  const agentConfig = useAgentConfigStore.getState().getConfig(annotation.type)

  const systemPrompt = RESOLVER_SYSTEM_PROMPT.replace('{{sessionContext}}', contextSummary)
  let typePrompt = TYPE_PROMPTS[annotation.type] || TYPE_PROMPTS.thought
  if (agentConfig.customInstructions) {
    typePrompt = agentConfig.customInstructions + '\n\n' + typePrompt
  }

  const scope = annotation.anchor.scope
  const scopeLimit = SCOPE_TOKEN_LIMITS[scope]
  const verbosity = resolveAdaptiveVerbosity(annotation)
  const verbosityMul = VERBOSITY_MULTIPLIER[verbosity]
  const effectiveMaxTokens = Math.round(Math.min(agentConfig.maxTokens, scopeLimit) * verbosityMul)
  const scopeInstruction = SCOPE_INSTRUCTIONS[scope]
  const reviewProgress = buildReviewProgress(annotation.id)

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `ANNOTATION:
  Type: ${annotation.type}
  Scope: ${scope}
  User said: "${annotation.transcript}"
  Selected text: "${annotation.anchor.text}"

CONTEXT:
  Local block: "${localBlock}"
  Section: "${sectionText.slice(0, 1000)}"
${reviewProgress}

${typePrompt}

IMPORTANT: This is a ${scope}-level annotation. Your response MUST be proportional — ${scopeInstruction}.${VERBOSITY_INSTRUCTIONS[verbosity] ? `\n\nVERBOSITY: ${VERBOSITY_INSTRUCTIONS[verbosity]}` : ''}

${annotation.type === 'edit'
  ? `If you're suggesting a text replacement, format it as:\n\nSUGGESTED EDIT:\n[the replacement text]\n\nREASON:\n[brief explanation]`
  : ''}`,
    },
  ]

  try {
    const response = await fetch('/api/resolve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'x-provider': config.provider,
        'x-model': config.model,
        ...(config.baseUrl ? { 'x-base-url': config.baseUrl } : {}),
      },
      body: JSON.stringify({ messages, maxTokens: effectiveMaxTokens, temperature: agentConfig.temperature, logprobs: true }),
    })

    if (!response.ok) {
      throw new Error(`Resolution failed: ${response.statusText}`)
    }

    const data = await response.json()
    const content = data.content
    const responseId = data.responseId ?? crypto.randomUUID()

    // Update session context with this annotation
    useSessionStore.getState().appendToHistory(
      `[${annotation.type}] User said: "${annotation.transcript}" on "${annotation.anchor.text.slice(0, 50)}..." → Agent responded.`
    )

    const resolution: Resolution = {
      type: annotation.type,
      content,
      suggestedEdit: annotation.type === 'edit' ? parseSuggestedEdit(content, annotation) : null,
      actions: ACTIONS_BY_TYPE[annotation.type] || ACTIONS_BY_TYPE.flag,
      logprobs: data.logprobs ?? null,
    }

    // Audit log for single-agent resolution (non-blocking)
    logResolutionAudit({
      annotationType: annotation.type,
      transcript: annotation.transcript,
      modelName: config.provider,
      modelVersion: config.model,
      promptVersion: 'RESOLVER_v1',
      responseId,
      usedMADS: false,
    }).then((auditId) => {
      if (auditId) {
        resolution.auditId = auditId
        useChangesStore.getState().linkAuditToAnnotation(annotation, auditId)
      }
    }).catch((e) => {
      // EU AI Act ledger write failed — surface incomplete coverage, don't drop silently
      console.error('Audit log failed (single-agent)', e)
      resolution.auditFailed = true
    })

    // Attach multi-region cascade edits (best-effort)
    await attachCascadeEdits(resolution, editorState, config, annotation.anchor.text)

    return resolution
  } catch (err) {
    return {
      type: annotation.type,
      content: `Error: ${err instanceof Error ? err.message : 'Resolution failed'}. Please check your API key and try again.`,
      suggestedEdit: null,
      actions: [{ label: 'Dismiss', kind: 'dismiss', handler: 'dismiss' }],
    }
  }
}

/**
 * Streaming variant of resolveAnnotation.
 * Calls onChunk with accumulated content as each SSE delta arrives,
 * then returns the final Resolution once the stream completes.
 *
 * MADS resolutions are not streamed (multi-agent debate is multi-step);
 * they fall through to the non-streaming path and call onChunk once at the end.
 */
export async function streamResolveAnnotation(
  annotation: Annotation,
  editorState: EditorState,
  onChunk: (partialContent: string) => void,
): Promise<Resolution> {
  const config = useSettingsStore.getState().llmConfig
  const sessionContext = useSessionStore.getState().context

  await maybeCompactContext()

  const localBlock = getBlockText(editorState, annotation.anchor.from)
  const sectionText = getSectionText(editorState, annotation.anchor.from)
  const contextSummary = sessionContext.annotationHistory || 'No prior context.'

  // MADS doesn't stream — fall back to non-streaming for complex intents
  try {
    const madsResult = await runMADS(annotation, sectionText)
    if (madsResult) {
      logResolutionAudit({
        annotationType: annotation.type,
        transcript: annotation.transcript,
        modelName: config.provider,
        modelVersion: config.model,
        promptVersion: 'MADS_v1',
        responseId: crypto.randomUUID(),
        usedMADS: true,
      }).then((auditId) => {
        if (auditId) {
          madsResult.resolution.auditId = auditId
          useChangesStore.getState().linkAuditToAnnotation(annotation, auditId)
        }
      })
      if (madsResult.uncertaintyFlags.length > 0) {
        madsResult.resolution.uncertaintyFlags = madsResult.uncertaintyFlags
      }
      onChunk(madsResult.resolution.content)
      return madsResult.resolution
    }
  } catch {
    // MADS failed — fall through
  }

  const agentConfig = useAgentConfigStore.getState().getConfig(annotation.type)
  const systemPrompt = RESOLVER_SYSTEM_PROMPT.replace('{{sessionContext}}', contextSummary)
  let typePrompt = TYPE_PROMPTS[annotation.type] || TYPE_PROMPTS.thought
  if (agentConfig.customInstructions) {
    typePrompt = agentConfig.customInstructions + '\n\n' + typePrompt
  }

  const scope = annotation.anchor.scope
  const scopeLimit = SCOPE_TOKEN_LIMITS[scope]
  const verbosity = resolveAdaptiveVerbosity(annotation)
  const verbosityMul = VERBOSITY_MULTIPLIER[verbosity]
  const effectiveMaxTokens = Math.round(Math.min(agentConfig.maxTokens, scopeLimit) * verbosityMul)
  const scopeInstruction = SCOPE_INSTRUCTIONS[scope]
  const reviewProgress = buildReviewProgress(annotation.id)

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `ANNOTATION:
  Type: ${annotation.type}
  Scope: ${scope}
  User said: "${annotation.transcript}"
  Selected text: "${annotation.anchor.text}"

CONTEXT:
  Local block: "${localBlock}"
  Section: "${sectionText.slice(0, 1000)}"
${reviewProgress}

${typePrompt}

IMPORTANT: This is a ${scope}-level annotation. Your response MUST be proportional — ${scopeInstruction}.${VERBOSITY_INSTRUCTIONS[verbosity] ? `\n\nVERBOSITY: ${VERBOSITY_INSTRUCTIONS[verbosity]}` : ''}

${annotation.type === 'edit'
  ? `If you're suggesting a text replacement, format it as:\n\nSUGGESTED EDIT:\n[the replacement text]\n\nREASON:\n[brief explanation]`
  : ''}`,
    },
  ]

  try {
    const response = await fetch('/api/resolve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'x-provider': config.provider,
        'x-model': config.model,
        ...(config.baseUrl ? { 'x-base-url': config.baseUrl } : {}),
      },
      body: JSON.stringify({
        messages,
        maxTokens: effectiveMaxTokens,
        temperature: agentConfig.temperature,
        stream: true,
      }),
    })

    if (!response.ok) {
      throw new Error(`Resolution failed: ${response.statusText}`)
    }

    if (!response.body) {
      throw new Error('No response body for stream')
    }

    // Parse SSE stream
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let responseId = crypto.randomUUID()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          // Store event type for next data line
          continue
        }
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()

        let parsed: any
        try {
          parsed = JSON.parse(payload)
        } catch {
          continue // Ignore malformed JSON lines
        }
        if (parsed.responseId) {
          responseId = parsed.responseId
        } else if (parsed.text) {
          content += parsed.text
          onChunk(content)
        } else if (parsed.error) {
          throw new Error(parsed.error)
        }
      }
    }

    useSessionStore.getState().appendToHistory(
      `[${annotation.type}] User said: "${annotation.transcript}" on "${annotation.anchor.text.slice(0, 50)}..." → Agent responded.`
    )

    const resolution: Resolution = {
      type: annotation.type,
      content,
      suggestedEdit: annotation.type === 'edit' ? parseSuggestedEdit(content, annotation) : null,
      actions: ACTIONS_BY_TYPE[annotation.type] || ACTIONS_BY_TYPE.flag,
    }

    logResolutionAudit({
      annotationType: annotation.type,
      transcript: annotation.transcript,
      modelName: config.provider,
      modelVersion: config.model,
      promptVersion: 'RESOLVER_v1',
      responseId,
      usedMADS: false,
    }).then((auditId) => {
      if (auditId) {
        resolution.auditId = auditId
        useChangesStore.getState().linkAuditToAnnotation(annotation, auditId)
      }
    }).catch((e) => {
      // EU AI Act ledger write failed — surface incomplete coverage, don't drop silently
      console.error('Audit log failed (single-agent)', e)
      resolution.auditFailed = true
    })

    // Attach multi-region cascade edits (best-effort)
    await attachCascadeEdits(resolution, editorState, config, annotation.anchor.text)

    return resolution
  } catch (err) {
    const errorContent = `Error: ${err instanceof Error ? err.message : 'Resolution failed'}. Please check your API key and try again.`
    onChunk(errorContent)
    return {
      type: annotation.type,
      content: errorContent,
      suggestedEdit: null,
      actions: [{ label: 'Dismiss', kind: 'dismiss', handler: 'dismiss' }],
    }
  }
}

export async function continueThread(
  annotation: Annotation,
  followUp: string,
  editorState: EditorState,
): Promise<ConversationMessage> {
  const config = useSettingsStore.getState().llmConfig
  const sessionContext = useSessionStore.getState().context

  // Build context
  const localBlock = getBlockText(editorState, annotation.anchor.from)
  const sectionText = getSectionText(editorState, annotation.anchor.from)
  const contextSummary = sessionContext.annotationHistory || 'No prior context.'

  const agentConfig = useAgentConfigStore.getState().getConfig(annotation.type)

  const systemPrompt = RESOLVER_SYSTEM_PROMPT.replace('{{sessionContext}}', contextSummary)
  let typePrompt = TYPE_PROMPTS[annotation.type] || TYPE_PROMPTS.thought
  if (agentConfig.customInstructions) {
    typePrompt = agentConfig.customInstructions + '\n\n' + typePrompt
  }

  const scope = annotation.anchor.scope
  const scopeLimit = SCOPE_TOKEN_LIMITS[scope]
  const verbosity = resolveAdaptiveVerbosity(annotation)
  const verbosityMul = VERBOSITY_MULTIPLIER[verbosity]
  const effectiveMaxTokens = Math.round(Math.min(agentConfig.maxTokens, scopeLimit) * verbosityMul)
  const scopeInstruction = SCOPE_INSTRUCTIONS[scope]
  const reviewProgress = buildReviewProgress(annotation.id)

  // Build messages from full conversation history
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `ANNOTATION:
  Type: ${annotation.type}
  Scope: ${scope}
  User said: "${annotation.transcript}"
  Selected text: "${annotation.anchor.text}"

CONTEXT:
  Local block: "${localBlock}"
  Section: "${sectionText.slice(0, 1000)}"
${reviewProgress}

${typePrompt}

IMPORTANT: This is a ${scope}-level annotation. Your response MUST be proportional — ${scopeInstruction}.${VERBOSITY_INSTRUCTIONS[verbosity] ? `\n\nVERBOSITY: ${VERBOSITY_INSTRUCTIONS[verbosity]}` : ''}

${annotation.type === 'edit'
  ? `If you're suggesting a text replacement, format it as:\n\nSUGGESTED EDIT:\n[the replacement text]\n\nREASON:\n[brief explanation]`
  : ''}`,
    },
  ]

  // Add conversation history
  for (const msg of annotation.conversation) {
    messages.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    })
  }

  // Add the new follow-up
  messages.push({ role: 'user', content: followUp })

  try {
    const response = await fetch('/api/resolve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'x-provider': config.provider,
        'x-model': config.model,
        ...(config.baseUrl ? { 'x-base-url': config.baseUrl } : {}),
      },
      body: JSON.stringify({ messages, maxTokens: effectiveMaxTokens, temperature: agentConfig.temperature }),
    })

    if (!response.ok) {
      throw new Error(`Thread continuation failed: ${response.statusText}`)
    }

    const data = await response.json()
    const content = data.content

    // Update session context
    useSessionStore.getState().appendToHistory(
      `[${annotation.type}] Follow-up: "${followUp.slice(0, 50)}..." → Agent responded.`
    )

    return {
      id: generateId(),
      role: 'agent',
      content,
      suggestedEdit: annotation.type === 'edit' ? parseSuggestedEdit(content, annotation) : null,
      timestamp: Date.now(),
    }
  } catch (err) {
    return {
      id: generateId(),
      role: 'agent',
      content: `Error: ${err instanceof Error ? err.message : 'Thread continuation failed'}. Please try again.`,
      suggestedEdit: null,
      timestamp: Date.now(),
    }
  }
}

export async function simplifyThread(
  annotation: Annotation,
): Promise<string> {
  const config = useSettingsStore.getState().llmConfig

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: 'You are a helpful writing assistant. Summarize conversations concisely.',
    },
    {
      role: 'user',
      content: `Summarize this conversation into a single concise resolution. If there's a final suggested edit, include it in SUGGESTED EDIT: format.

Annotation type: ${annotation.type}
Original request: "${annotation.transcript}"
Selected text: "${annotation.anchor.text}"

Conversation:
${annotation.conversation.map((msg) => `${msg.role === 'user' ? 'User' : 'Agent'}: ${msg.content}`).join('\n\n')}`,
    },
  ]

  try {
    const response = await fetch('/api/resolve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'x-provider': config.provider,
        'x-model': config.model,
        ...(config.baseUrl ? { 'x-base-url': config.baseUrl } : {}),
      },
      body: JSON.stringify({ messages, maxTokens: 500, temperature: 0.2 }),
    })

    if (!response.ok) {
      throw new Error(`Simplification failed: ${response.statusText}`)
    }

    const data = await response.json()
    return data.content
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : 'Simplification failed'}.`
  }
}

// ---------------------------------------------------------------------------
// Context Compaction (per spec Section 3)
// ---------------------------------------------------------------------------

// Rough token estimate: ~4 chars per token
const CHARS_PER_TOKEN = 4
// Compact when session context exceeds this many estimated tokens. Current
// Claude models carry a 200k+ window; 64k is a conservative early trigger that
// keeps sub-agent calls cheap rather than a hard fraction of the window.
const COMPACTION_THRESHOLD_TOKENS = 64000

/**
 * Check if the session context is getting too large and compact it.
 * Per agent-orchestration.mdc Section 3: trigger summarization when
 * context exceeds 50% of the model's maximum context window.
 */
async function maybeCompactContext(): Promise<void> {
  const session = useSessionStore.getState()
  const history = session.context.annotationHistory

  if (!history) return

  const estimatedTokens = Math.ceil(history.length / CHARS_PER_TOKEN)

  if (estimatedTokens < COMPACTION_THRESHOLD_TOKENS) return

  const config = useSettingsStore.getState().llmConfig

  const prompt = CONTEXT_COMPRESSION_PROMPT.replace('{{history}}', history)

  // Compaction is pure housekeeping — pin it to the cheapest capable model so it
  // never runs at Opus/Fable prices when the user has selected one of those.
  const compactionModel = pickUtilityModel(config)

  try {
    const response = await fetch('/api/resolve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'x-provider': config.provider,
        'x-model': compactionModel,
        ...(config.baseUrl ? { 'x-base-url': config.baseUrl } : {}),
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 500,
        temperature: 0.2,
      }),
    })

    if (!response.ok) return

    const data = await response.json()
    const compacted = data.content

    if (compacted && compacted.length < history.length) {
      session.updateContext({
        annotationHistory: `[Compacted session summary]\n${compacted}`,
        totalTokens: Math.ceil(compacted.length / CHARS_PER_TOKEN),
      })
    }
  } catch {
    // Non-blocking — if compaction fails, continue with existing context
  }
}
