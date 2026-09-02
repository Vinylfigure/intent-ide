import { describe, it, expect } from 'vitest'
import {
  CLASSIFICATION_PROMPT,
  RESOLVER_SYSTEM_PROMPT,
  TYPE_PROMPTS,
  CONTEXT_COMPRESSION_PROMPT,
} from '../prompts'

describe('Classification prompt', () => {
  it('includes all 4 annotation types', () => {
    expect(CLASSIFICATION_PROMPT).toContain('ASK')
    expect(CLASSIFICATION_PROMPT).toContain('EDIT')
    expect(CLASSIFICATION_PROMPT).toContain('DIG')
    expect(CLASSIFICATION_PROMPT).toContain('FLAG')
  })

  it('frames the classifier as a document review tool', () => {
    expect(CLASSIFICATION_PROMPT).toContain('document review tool')
  })

  it('includes template placeholders', () => {
    expect(CLASSIFICATION_PROMPT).toContain('{{transcript}}')
    expect(CLASSIFICATION_PROMPT).toContain('{{anchoredText}}')
  })

  it('instructs to respond with only the type name', () => {
    expect(CLASSIFICATION_PROMPT).toContain('ONLY the type name')
  })
})

describe('Resolver system prompt', () => {
  it('frames agent as a professional reviewer', () => {
    expect(RESOLVER_SYSTEM_PROMPT).toContain('lawyer')
    expect(RESOLVER_SYSTEM_PROMPT).toContain('auditor')
    expect(RESOLVER_SYSTEM_PROMPT).toContain('PM')
  })

  it('instructs to build on prior findings', () => {
    expect(RESOLVER_SYSTEM_PROMPT).toContain('Build on prior findings')
  })

  it('enforces response length proportional to selection', () => {
    expect(RESOLVER_SYSTEM_PROMPT).toContain('Match response length to selection size')
  })

  it('treats thoughts as seeds', () => {
    expect(RESOLVER_SYSTEM_PROMPT).toContain('seed to investigate')
  })

  it('requires cross-referencing', () => {
    expect(RESOLVER_SYSTEM_PROMPT).toContain('cross-references')
  })

  it('includes session context placeholder', () => {
    expect(RESOLVER_SYSTEM_PROMPT).toContain('{{sessionContext}}')
  })
})

describe('Type prompts', () => {
  it('has prompts for all 4 types', () => {
    expect(TYPE_PROMPTS).toHaveProperty('ask')
    expect(TYPE_PROMPTS).toHaveProperty('edit')
    expect(TYPE_PROMPTS).toHaveProperty('dig')
    expect(TYPE_PROMPTS).toHaveProperty('flag')
  })

  it('ask prompt references margin note pattern', () => {
    expect(TYPE_PROMPTS.ask).toContain('margin note')
  })

  it('edit prompt checks for inconsistencies', () => {
    expect(TYPE_PROMPTS.edit).toContain('inconsistencies')
  })

  it('dig prompt references auditor research', () => {
    expect(TYPE_PROMPTS.dig).toContain('auditor')
  })

  it('flag prompt checks for patterns and contradictions', () => {
    expect(TYPE_PROMPTS.flag).toContain('contradiction')
  })
})

describe('Context compression prompt', () => {
  it('captures reviewer working notes', () => {
    expect(CONTEXT_COMPRESSION_PROMPT).toContain('working notes')
  })

  it('tracks cross-references', () => {
    expect(CONTEXT_COMPRESSION_PROMPT).toContain('Cross-references')
  })

  it('captures evolving thesis', () => {
    expect(CONTEXT_COMPRESSION_PROMPT).toContain('evolving thesis')
  })

  it('includes template placeholder', () => {
    expect(CONTEXT_COMPRESSION_PROMPT).toContain('{{history}}')
  })
})

describe('RESOLVER_SYSTEM_PROMPT — grounding', () => {
  it('requires document knowledge and the model\'s own to be told apart', () => {
    // The reported failure: a reader asked what "Atlantis" was. The document
    // names it in a heading and never explains it, and nothing asked the model
    // to say so — it just answered, wrongly and confidently.
    expect(RESOLVER_SYSTEM_PROMPT).toContain('label the second kind')
  })

  it('does not ask the model to JUDGE whether a term is defined', () => {
    // Measured on qwen3:8b: told to decide for itself, it invented a
    // definition out of the surrounding words — worse than saying nothing.
    // The fact is computed in intentContext.ts and stated; this prompt only
    // says to obey it. See intentContext's undefined-term tests.
    expect(RESOLVER_SYSTEM_PROMPT).toContain('stated for you in the')
  })

  it('forbids inventing a cross-reference', () => {
    // Paired with the "nothing else bears on this" context line: without this
    // rule an empty related-passages section is an invitation to gesture at a
    // section that might exist.
    expect(RESOLVER_SYSTEM_PROMPT).toContain('Never invent a cross-reference')
  })
})
