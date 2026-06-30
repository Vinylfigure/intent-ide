// New 4-intent system (Wave 2)
export type AnnotationType = 'ask' | 'edit' | 'dig' | 'flag'

// Legacy types for backward compatibility during hydration
export type LegacyAnnotationType = 'question' | 'fix' | 'explore' | 'thought' | 'correction' | 'restructure'

export type AnyAnnotationType = AnnotationType | LegacyAnnotationType

/** Map legacy 6-type system to new 4-type system */
export function mapLegacyType(type: string): AnnotationType {
  switch (type) {
    case 'question': return 'ask'
    case 'fix': return 'edit'
    case 'correction': return 'edit'
    case 'restructure': return 'edit'
    case 'explore': return 'dig'
    case 'thought': return 'flag'
    // Already new types
    case 'ask': return 'ask'
    case 'edit': return 'edit'
    case 'dig': return 'dig'
    case 'flag': return 'flag'
    default: return 'flag'
  }
}

export type AnnotationStatus = 'pending' | 'classified' | 'resolving' | 'resolved' | 'applied' | 'dismissed'

export type Scope = 'phrase' | 'sentence' | 'paragraph' | 'section'

export type Verbosity = 'concise' | 'normal' | 'detailed'

export function getDefaultVerbosity(scope: Scope, type: AnnotationType): Verbosity {
  if (scope === 'section' && type === 'dig') return 'normal'
  return 'concise'
}

export interface TextAnchor {
  from: number
  to: number
  scope: Scope
  text: string
}

export interface ConversationMessage {
  id: string
  role: 'user' | 'agent'
  content: string
  suggestedEdit: SuggestedEdit | null
  timestamp: number
}

export interface Annotation {
  id: string
  documentId: string
  locationGroupKey: string
  type: AnnotationType
  status: AnnotationStatus
  transcript: string
  anchor: TextAnchor
  resolution: Resolution | null
  conversation: ConversationMessage[]
  parentId: string | null
  childIds: string[]
  createdAt: number
  resolvedAt: number | null
  verbosity: Verbosity
}

export interface Resolution {
  type: AnnotationType
  content: string
  suggestedEdit: SuggestedEdit | null
  actions: ResolutionAction[]
  /** Audit trail ID for EU AI Act compliance (set after async logging) */
  auditId?: string
  /** OpenAI logprobs for token-level uncertainty visualization */
  logprobs?: { content: Array<{ token: string; logprob: number; top_logprobs: Array<{ token: string; logprob: number }> }> } | null
  /** MADS Judge uncertainty flags (fallback when logprobs unavailable) */
  uncertaintyFlags?: string[]
  /** Strongest unresolved Troublemaker objection from MADS debate (shown as inline provocation) */
  provocation?: string | null
  /** Whether this resolution came from MADS (multi-agent debate) — indicates higher-risk edit */
  usedMADS?: boolean
}

export interface SuggestedEdit {
  from: number
  to: number
  newText: string
  reason: string
}

export interface ResolutionAction {
  label: string
  kind: 'apply' | 'accept' | 'deepen' | 'dismiss' | 'undo'
  handler: string
}

export const ANNOTATION_COLORS: Record<AnnotationType, string> = {
  ask: '#2b5fc4',
  edit: '#c44b2b',
  dig: '#6b4dc4',
  flag: '#d97706',
}

export const ANNOTATION_LABELS: Record<AnnotationType, string> = {
  ask: 'Ask',
  edit: 'Edit',
  dig: 'Dig',
  flag: 'Flag',
}

export const ANNOTATION_DESCRIPTIONS: Record<AnnotationType, string> = {
  ask: 'Get clarification about this text',
  edit: 'Change, fix, or restructure this text',
  dig: 'Investigate deeper, research implications',
  flag: 'Mark something problematic for AI investigation',
}
