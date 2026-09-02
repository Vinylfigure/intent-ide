// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { EditorState } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'
import { useDocGraphStore } from '@/stores/docGraphStore'
import type { DocGraph, DocGraphNode } from '@/lib/graphrag/docGraph'
import { buildIntentContext, formatIntentContext, type IntentContext } from '../intentContext'

// The reported failure: a reader selected "Atlantis" — a term the document
// names in a heading and never explains — and asked what it was. The model
// invented a definition out of the neighbouring words.
//
// The fix is deliberately NOT an instruction to the model. Measured on
// qwen3:8b, asking it to judge for itself whether a term was defined made the
// answer worse. So the fact is computed here and stated. These tests cover the
// computation and the emission; the model's obedience to a stated fact is
// covered live in tests/local-model.spec.ts.

function p(blockId: string, text: string): PMNode {
  return schema.node('paragraph', { blockId }, [schema.text(text)])
}

function graphOf(nodes: Array<{ blockId: string; text: string; definedTerms?: string[] }>): DocGraph {
  const map = new Map<string, DocGraphNode>()
  for (const n of nodes) {
    map.set(n.blockId, {
      blockId: n.blockId,
      pos: 0,
      nodeType: 'paragraph',
      text: n.text,
      headingPath: [],
      definedTerms: n.definedTerms ?? [],
    })
  }
  return {
    contentHash: 'h',
    builtAt: 0,
    llmApplied: false,
    llmPartial: false,
    embeddingsApplied: false,
    embeddingsPartial: false,
    graphitiApplied: false,
    graphitiEpisodeGen: -1,
    blockHashes: new Map(),
    nodes: map,
    edges: [],
    adjacency: new Map(),
  }
}

/** An editor state whose first block carries `blockId` 'a'. */
function stateWith(text: string): EditorState {
  return EditorState.create({ schema, doc: schema.node('doc', null, [p('a', text)]) })
}

beforeEach(() => {
  useDocGraphStore.setState({ graph: null })
})

describe('buildIntentContext — undefined-term detection', () => {
  it('reports a term the document names but never defines', async () => {
    useDocGraphStore.setState({ graph: graphOf([{ blockId: 'a', text: 'Terraform / Atlantis sniff test' }]) })
    const ctx = await buildIntentContext(stateWith('Terraform / Atlantis sniff test'), 1, 'section', undefined, 'Atlantis')
    expect(ctx.undefinedTerm).toBe('Atlantis')
  })

  it('stays silent when the document does define the term', async () => {
    useDocGraphStore.setState({
      graph: graphOf([{ blockId: 'a', text: 'Atlantis means the PR automation layer.', definedTerms: ['Atlantis'] }]),
    })
    const ctx = await buildIntentContext(stateWith('Atlantis means the PR automation layer.'), 1, 'section', undefined, 'Atlantis')
    expect(ctx.undefinedTerm).toBeNull()
  })

  it('counts a partial match against a longer defined term as defined', async () => {
    // A false "not defined" is the costlier error: it would have the model
    // announce an absence the reader can plainly see is wrong.
    useDocGraphStore.setState({
      graph: graphOf([{ blockId: 'a', text: 'x', definedTerms: ['Retention Period'] }]),
    })
    const ctx = await buildIntentContext(stateWith('x'), 1, 'phrase', undefined, 'Retention')
    expect(ctx.undefinedTerm).toBeNull()
  })

  it('ignores case when matching a defined term', async () => {
    useDocGraphStore.setState({ graph: graphOf([{ blockId: 'a', text: 'x', definedTerms: ['aegis'] }]) })
    const ctx = await buildIntentContext(stateWith('x'), 1, 'phrase', undefined, 'Aegis')
    expect(ctx.undefinedTerm).toBeNull()
  })

  it('does not fire for a selection too long to be a term', async () => {
    // Past a name and into a passage, "the document does not define this"
    // stops being a meaningful thing to say.
    useDocGraphStore.setState({ graph: graphOf([{ blockId: 'a', text: 'x' }]) })
    const long = 'a'.repeat(61)
    const ctx = await buildIntentContext(stateWith('x'), 1, 'paragraph', undefined, long)
    expect(ctx.undefinedTerm).toBeNull()
  })

  it('stays silent on a cold graph rather than claiming an absence it cannot know', async () => {
    useDocGraphStore.setState({ graph: null })
    const ctx = await buildIntentContext(stateWith('Atlantis'), 1, 'section', undefined, 'Atlantis')
    expect(ctx.graphUnavailable).toBe(true)
    expect(ctx.undefinedTerm).toBeNull()
  })

  it('stays silent when no selection text was supplied', async () => {
    useDocGraphStore.setState({ graph: graphOf([{ blockId: 'a', text: 'x' }]) })
    const ctx = await buildIntentContext(stateWith('x'), 1, 'phrase')
    expect(ctx.undefinedTerm).toBeNull()
  })
})

describe('formatIntentContext — how the fact is stated', () => {
  const base: IntentContext = {
    localBlock: 'Terraform / Atlantis sniff test',
    sectionText: 'The stated process was IaC.',
    headingPath: ['Anchor stories'],
    definedTerms: [],
    related: [],
    relatedSuppressed: 0,
    invariants: [],
    undefinedTerm: null,
    graphUnavailable: false,
  }

  it('emits nothing extra when the term is defined', () => {
    expect(formatIntentContext(base)).not.toContain('DOES NOT DEFINE')
  })

  it('states the absence and prescribes the opening line', () => {
    const out = formatIntentContext({ ...base, undefinedTerm: 'Atlantis' })
    expect(out).toContain('THIS DOCUMENT DOES NOT DEFINE "Atlantis"')
    expect(out).toContain('Begin your answer with: This document does not define "Atlantis".')
    expect(out).toContain('From outside the document:')
  })

  it('forbids building the definition out of neighbouring sentences', () => {
    // The exact observed failure mode: told to judge for itself, the model
    // glossed "Atlantis" as "a Terraform sniff test" — the words beside it.
    const out = formatIntentContext({ ...base, undefinedTerm: 'Atlantis' })
    expect(out).toContain('the words next to')
  })

  it('puts the instruction last, nearest the generation', () => {
    // Buried among the system rules it lost to the type prompt ("2-3 key
    // insights, bullets") and the model ignored it.
    const out = formatIntentContext({
      ...base,
      undefinedTerm: 'Atlantis',
      related: [
        { blockId: 'b', text: 'other', headingPath: [], hop: 1, why: 'references', whyPath: 'references', score: 0.9 },
      ],
    })
    expect(out.lastIndexOf('DOES NOT DEFINE')).toBeGreaterThan(out.lastIndexOf('RELATED PASSAGES'))
  })
})
