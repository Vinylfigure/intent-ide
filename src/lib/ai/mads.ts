/**
 * Multi-Agent Debating System (MADS) Orchestrator.
 *
 * Implements a LangGraph-style cyclic state machine in TypeScript:
 *   routeIntent → [simple path] → single agent
 *   routeIntent → [complex path] → Troublemaker → Peacemaker → Judge → result
 *
 * Agents:
 *   - Troublemaker (Level 1 Sycophancy): challenges the user's intent, finds edge cases
 *   - Peacemaker (Level 5 Sycophancy): synthesizes safe common ground
 *   - Judge: verifies factual consistency using graph dependency chains
 */

import { callLLM, type LLMConfig, type LLMMessage } from './client'
import { useSettingsStore } from '@/stores/settingsStore'
import { useSessionStore } from '@/stores/sessionStore'
import { searchNodes, searchFacts } from '@/lib/mcp/graphitiClient'
import {
  TROUBLEMAKER_PROMPT,
  PEACEMAKER_PROMPT,
  JUDGE_PROMPT,
  INTENT_COMPLEXITY_PROMPT,
  RESOLVER_SYSTEM_PROMPT,
} from './prompts'
import type { Annotation, Resolution, ResolutionAction, SuggestedEdit } from '@/lib/annotations/types'

// ---------------------------------------------------------------------------
// MADS State (LangGraph-style)
// ---------------------------------------------------------------------------

export interface MADSState {
  // Input
  annotation: Annotation
  documentContext: string
  sectionContext: string
  sessionContext: string

  // Graph context (fetched from GraphRAG)
  graphContext: string

  // Debate rounds
  troublemakerOutput: string | null
  peacemakerOutput: string | null
  judgeOutput: string | null

  // Result
  verdict: 'APPROVE' | 'MODIFY' | 'REJECT' | null
  finalResolution: string | null
  uncertaintyFlags: string[]

  // Metadata
  complexity: 'simple' | 'complex'
  debateRounds: number
}

export interface MADSResult {
  resolution: Resolution
  debateLog: string
  uncertaintyFlags: string[]
  usedMADS: boolean
}

// ---------------------------------------------------------------------------
// Intent Routing (LangGraph conditional edge)
// ---------------------------------------------------------------------------

async function classifyComplexity(
  annotation: Annotation,
  config: LLMConfig,
): Promise<'simple' | 'complex'> {
  // Edit types route through MADS (higher-friction flow for mutations)
  if (annotation.type === 'edit') {
    return 'complex'
  }

  // Ask and dig are always simple (non-mutating)
  if (annotation.type === 'ask' || annotation.type === 'dig') {
    return 'simple'
  }

  // For flag, ask the LLM to classify (may reveal something that needs debate)
  const prompt = INTENT_COMPLEXITY_PROMPT
    .replace('{{type}}', annotation.type)
    .replace('{{transcript}}', annotation.transcript)
    .replace('{{selectedText}}', annotation.anchor.text)

  try {
    const result = await callLLM(
      [{ role: 'user', content: prompt }],
      config,
      { maxTokens: 10, temperature: 0 },
    )
    return result.trim().toLowerCase().includes('complex') ? 'complex' : 'simple'
  } catch {
    // On error, default to simple to avoid blocking
    return 'simple'
  }
}

// ---------------------------------------------------------------------------
// Graph Context Fetcher
// ---------------------------------------------------------------------------

async function fetchGraphContext(annotation: Annotation): Promise<string> {
  try {
    const query = annotation.anchor.text.slice(0, 200)

    // Parallel fetch: nodes + facts
    const [nodes, facts] = await Promise.all([
      searchNodes(query, 5),
      searchFacts(query, 5),
    ])

    if (nodes.length === 0 && facts.length === 0) {
      return 'No relevant entities or relationships found in knowledge graph.'
    }

    const parts: string[] = []

    if (nodes.length > 0) {
      parts.push('ENTITIES:')
      for (const node of nodes) {
        parts.push(`  - ${node.name}: ${node.summary}`)
      }
    }

    if (facts.length > 0) {
      parts.push('RELATIONSHIPS:')
      for (const fact of facts) {
        parts.push(`  - ${fact.fact}`)
      }
    }

    return parts.join('\n')
  } catch {
    return 'Knowledge graph unavailable.'
  }
}

// ---------------------------------------------------------------------------
// Agent Nodes
// ---------------------------------------------------------------------------

async function runTroublemakerAgent(
  state: MADSState,
  config: LLMConfig,
): Promise<string> {
  const messages: LLMMessage[] = [
    { role: 'system', content: TROUBLEMAKER_PROMPT },
    {
      role: 'user',
      content: `ANNOTATION:
  Type: ${state.annotation.type}
  User said: "${state.annotation.transcript}"
  Selected text: "${state.annotation.anchor.text}"

DOCUMENT CONTEXT:
${state.sectionContext}

GRAPH CONTEXT:
${state.graphContext}

SESSION CONTEXT:
${state.sessionContext}

Analyze this intent. Find every edge case, conflict, and risk.`,
    },
  ]

  return callLLM(messages, config, { maxTokens: 600, temperature: 0.4 })
}

async function runPeacemakerAgent(
  state: MADSState,
  config: LLMConfig,
): Promise<string> {
  const messages: LLMMessage[] = [
    { role: 'system', content: PEACEMAKER_PROMPT },
    {
      role: 'user',
      content: `ANNOTATION:
  Type: ${state.annotation.type}
  User said: "${state.annotation.transcript}"
  Selected text: "${state.annotation.anchor.text}"

DOCUMENT CONTEXT:
${state.sectionContext}

GRAPH CONTEXT:
${state.graphContext}

TROUBLEMAKER'S CHALLENGES:
${state.troublemakerOutput}

Find safe, accurate common ground. Propose a resolution.`,
    },
  ]

  return callLLM(messages, config, { maxTokens: 600, temperature: 0.3 })
}

async function runJudgeAgent(
  state: MADSState,
  config: LLMConfig,
): Promise<string> {
  const messages: LLMMessage[] = [
    { role: 'system', content: JUDGE_PROMPT },
    {
      role: 'user',
      content: `ANNOTATION:
  Type: ${state.annotation.type}
  User said: "${state.annotation.transcript}"
  Selected text: "${state.annotation.anchor.text}"

DOCUMENT CONTEXT:
${state.sectionContext}

GRAPH CONTEXT:
${state.graphContext}

TROUBLEMAKER'S CHALLENGES:
${state.troublemakerOutput}

PEACEMAKER'S RESOLUTION:
${state.peacemakerOutput}

Issue your verdict. Check factual consistency.`,
    },
  ]

  return callLLM(messages, config, { maxTokens: 600, temperature: 0.2 })
}

// ---------------------------------------------------------------------------
// Result Parsing
// ---------------------------------------------------------------------------

function parseJudgeVerdict(output: string): 'APPROVE' | 'MODIFY' | 'REJECT' {
  const upper = output.toUpperCase()
  if (upper.includes('VERDICT: REJECT') || upper.includes('VERDICT:REJECT')) return 'REJECT'
  if (upper.includes('VERDICT: MODIFY') || upper.includes('VERDICT:MODIFY')) return 'MODIFY'
  return 'APPROVE'
}

function parseUncertaintyFlags(output: string): string[] {
  const flags: string[] = []
  const section = output.match(/UNCERTAINTY_FLAGS:\s*\n([\s\S]*?)(?:\n\n|$)/i)
  if (section) {
    const lines = section[1].split('\n')
    for (const line of lines) {
      const trimmed = line.replace(/^[-*]\s*/, '').trim()
      if (trimmed.length > 0) {
        flags.push(trimmed)
      }
    }
  }
  return flags
}

function parseSuggestedEditFromMADS(
  output: string,
  annotation: Annotation,
): SuggestedEdit | null {
  // Try to find FINAL RESOLUTION or SUGGESTED EDIT section
  const editMatch = output.match(
    /(?:FINAL RESOLUTION|SUGGESTED EDIT):\s*\n([\s\S]*?)(?:\n\s*(?:REASON|CONFIDENCE|UNCERTAINTY):|$)/i
  )
  const reasonMatch = output.match(/REASON:\s*\n?([\s\S]*?)(?:\n\s*(?:CONFIDENCE|UNCERTAINTY):|$)/i)

  if (editMatch) {
    const newText = editMatch[1].trim()
    if (newText.length > 0 && newText !== annotation.anchor.text) {
      return {
        from: annotation.anchor.from,
        to: annotation.anchor.to,
        newText,
        reason: reasonMatch ? reasonMatch[1].trim() : '',
      }
    }
  }

  return null
}

function buildDebateLog(state: MADSState): string {
  const parts: string[] = ['<chain-of-thought>']

  if (state.troublemakerOutput) {
    parts.push('## Troublemaker (Challenge)')
    parts.push(state.troublemakerOutput)
    parts.push('')
  }

  if (state.peacemakerOutput) {
    parts.push('## Peacemaker (Synthesis)')
    parts.push(state.peacemakerOutput)
    parts.push('')
  }

  if (state.judgeOutput) {
    parts.push('## Judge (Verdict)')
    parts.push(state.judgeOutput)
  }

  parts.push('</chain-of-thought>')
  return parts.join('\n')
}

/**
 * Extract the strongest unresolved Troublemaker objection as a provocation.
 * Looks for CHALLENGES section in Troublemaker output, picks the first bullet
 * that the Judge didn't explicitly address (heuristic: if Judge verdict is
 * MODIFY or REJECT, the challenges are unresolved).
 */
function extractProvocation(state: MADSState): string | null {
  if (!state.troublemakerOutput) return null

  // If the Judge approved without modification, challenges were resolved
  if (state.verdict === 'APPROVE') return null

  // Extract the first challenge bullet from Troublemaker output
  const challengeMatch = state.troublemakerOutput.match(/CHALLENGES:\s*\n([\s\S]*?)(?:\n\s*RISK ASSESSMENT:|$)/i)
  if (!challengeMatch) return null

  const bullets = challengeMatch[1]
    .split('\n')
    .map(line => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)

  if (bullets.length === 0) return null

  // Return the first (strongest) challenge as a provocation
  return bullets[0]
}

// Resolution action definitions for MADS results (4-type system)
const MADS_ACTIONS: Record<string, ResolutionAction[]> = {
  edit: [
    { label: 'Apply', kind: 'apply', handler: 'apply-edit' },
    { label: 'Tweak it', kind: 'deepen', handler: 'tweak' },
    { label: 'Show affected', kind: 'deepen', handler: 'show-cascade' },
    { label: 'Nevermind', kind: 'dismiss', handler: 'dismiss' },
  ],
  flag: [
    { label: 'Keep it', kind: 'accept', handler: 'park' },
    { label: 'Act on this', kind: 'apply', handler: 'act-on-thought' },
    { label: 'Research more', kind: 'deepen', handler: 'research' },
    { label: 'Dismiss', kind: 'dismiss', handler: 'dismiss' },
  ],
}

// ---------------------------------------------------------------------------
// Main Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the MADS pipeline on an annotation.
 *
 * State machine flow:
 *   1. classifyComplexity → simple | complex
 *   2. [complex] fetchGraphContext
 *   3. [complex] Troublemaker → Peacemaker → Judge
 *   4. Parse verdict + build resolution
 *
 * For simple intents, returns null — caller should use single-agent path.
 */
export async function runMADS(
  annotation: Annotation,
  sectionContext: string,
): Promise<MADSResult | null> {
  const config = useSettingsStore.getState().llmConfig
  const sessionContext = useSessionStore.getState().context.annotationHistory || 'No prior context.'

  // Step 1: Route intent
  const complexity = await classifyComplexity(annotation, config)

  if (complexity === 'simple') {
    return null // Caller falls back to single-agent resolution
  }

  // Step 2: Fetch graph context
  const graphContext = await fetchGraphContext(annotation)

  // Step 3: Initialize state
  const state: MADSState = {
    annotation,
    documentContext: '',
    sectionContext,
    sessionContext,
    graphContext,
    troublemakerOutput: null,
    peacemakerOutput: null,
    judgeOutput: null,
    verdict: null,
    finalResolution: null,
    uncertaintyFlags: [],
    complexity,
    debateRounds: 1,
  }

  // Step 4: Run debate — Troublemaker → Peacemaker → Judge
  state.troublemakerOutput = await runTroublemakerAgent(state, config)
  state.peacemakerOutput = await runPeacemakerAgent(state, config)
  state.judgeOutput = await runJudgeAgent(state, config)

  // Step 5: Parse results
  state.verdict = parseJudgeVerdict(state.judgeOutput)
  state.uncertaintyFlags = parseUncertaintyFlags(state.judgeOutput)

  // Step 6: Build resolution
  // Use Judge output as the primary resolution source
  const resolverOutput = state.verdict === 'REJECT'
    ? state.troublemakerOutput  // If rejected, show challenges
    : state.judgeOutput          // Otherwise, show judge's final resolution

  const suggestedEdit = state.verdict !== 'REJECT'
    ? parseSuggestedEditFromMADS(state.judgeOutput, annotation)
      ?? parseSuggestedEditFromMADS(state.peacemakerOutput ?? '', annotation)
    : null

  // Build debate log as chain-of-thought for AgentMarkdown rendering
  const debateLog = buildDebateLog(state)

  // Extract provocation: strongest unresolved Troublemaker objection
  const provocation = extractProvocation(state)

  // Compose final content: resolution + debate log
  const resolutionContent = state.verdict === 'REJECT'
    ? `The multi-agent review found issues with this change:\n\n${resolverOutput}\n\n${debateLog}`
    : `${resolverOutput}\n\n${debateLog}`

  const actions = MADS_ACTIONS[annotation.type] ?? MADS_ACTIONS.edit

  const resolution: Resolution = {
    type: annotation.type,
    content: resolutionContent,
    suggestedEdit,
    actions,
    provocation,
    usedMADS: true,
  }

  // Update session context
  useSessionStore.getState().appendToHistory(
    `[${annotation.type}][MADS] User said: "${annotation.transcript.slice(0, 50)}..." → Verdict: ${state.verdict}. Flags: ${state.uncertaintyFlags.length}.`
  )

  return {
    resolution,
    debateLog,
    uncertaintyFlags: state.uncertaintyFlags,
    usedMADS: true,
  }
}
