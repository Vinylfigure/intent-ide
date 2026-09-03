// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { schema } from '@/lib/prosemirror/schema'
import { looksLikeTerm } from '@/lib/ai/intentContext'
import type { DocGraph, DocGraphNode } from '@/lib/graphrag/docGraph'
import type { Annotation } from '@/lib/annotations/types'

// The reported bug: a reader highlighted "Model hallucination causes action",
// then asked and re-asked inside that one card. All five answers opened with
// the identical line — `This document does not define "Model hallucination
// causes action"`.
//
// The guard answers a question about the INITIAL selection ("you highlighted a
// term; does the document explain it?"). That is worth saying once. It is not
// a per-turn question, so a follow-up must not re-ask it at all.

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(k: string) { return this.store.get(k) ?? null }
  setItem(k: string, v: string) { this.store.set(k, v) }
  removeItem(k: string) { this.store.delete(k) }
  clear() { this.store.clear() }
}

vi.mock('@/lib/audit/auditLogger', () => ({ logResolutionAudit: vi.fn() }))

function graphOf(blockId: string, text: string): DocGraph {
  const nodes = new Map<string, DocGraphNode>([
    [blockId, { blockId, pos: 0, nodeType: 'paragraph', text, headingPath: [], definedTerms: [] }],
  ])
  return {
    contentHash: 'h', builtAt: 0,
    llmApplied: false, llmPartial: false,
    embeddingsApplied: false, embeddingsPartial: false,
    graphitiApplied: false, graphitiEpisodeGen: -1,
    blockHashes: new Map(), nodes, edges: [], adjacency: new Map(),
  }
}

function makeAnnotation(): Annotation {
  return {
    id: 'ann-1',
    documentId: 'doc-1',
    locationGroupKey: 'doc-1:1:5',
    type: 'ask',
    status: 'resolved',
    transcript: 'what is this?',
    // A term the document names and never defines — the guard's trigger case.
    anchor: { from: 1, to: 5, scope: 'phrase', text: 'Atlantis' },
    resolution: null,
    conversation: [],
    parentId: null,
    childIds: [],
    createdAt: 100,
    resolvedAt: 200,
    verbosity: 'normal',
  }
}

function makeEditorState(): EditorState {
  return EditorState.create({
    schema,
    doc: schema.node('doc', null, [
      schema.node('paragraph', { blockId: 'b1' }, [schema.text('Terraform / Atlantis sniff test')]),
    ]),
  })
}

/** Capture the messages actually sent to /api/resolve. */
function stubFetchCapturing(sent: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body))
      return { ok: true, statusText: 'OK', json: async () => ({ content: 'ok', responseId: 'r1' }) }
    }),
  )
}

function promptOf(sent: unknown[]): string {
  const body = sent[0] as { messages: Array<{ content: string }> }
  return body.messages.map((m) => m.content).join('\n')
}

/**
 * Load the resolver and seed the doc graph on the SAME module instance it will
 * read. `vi.resetModules()` hands every dynamic import a fresh module registry,
 * so seeding a store imported at the top of this file would set state on an
 * instance the resolver never sees — the tests would then pass against the
 * unfixed code, which is exactly what happened the first time these were
 * written.
 */
async function loadResolverWithGraph() {
  vi.resetModules()
  const { useDocGraphStore } = await import('@/stores/docGraphStore')
  useDocGraphStore.setState({ graph: graphOf('b1', 'Terraform / Atlantis sniff test') })
  const { continueThread } = await import('@/lib/ai/resolver')
  return { continueThread }
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('localStorage', new MemoryStorage())
})

describe('continueThread — the undefined-term line is said once, not every turn', () => {
  it('does not re-state it on a follow-up', async () => {
    const { continueThread } = await loadResolverWithGraph()
    const sent: unknown[] = []
    stubFetchCapturing(sent)

    await continueThread(makeAnnotation(), 'how are they identified?', makeEditorState())

    expect(promptOf(sent)).not.toContain('DOES NOT DEFINE')
  })

  it('does not re-state it for a DIRECTIVE follow-up either', async () => {
    // The case that would have defeated a subtler fix: feeding the follow-up
    // text to the guard instead. "elaborate on rate limiting" is four words,
    // has no terminal punctuation and does not begin with an interrogative, so
    // looksLikeTerm accepts it as a term — and the document of course does not
    // define it.
    const { continueThread } = await loadResolverWithGraph()
    const sent: unknown[] = []
    stubFetchCapturing(sent)

    await continueThread(makeAnnotation(), 'elaborate on rate limiting', makeEditorState())

    expect(promptOf(sent)).not.toContain('DOES NOT DEFINE')
  })

  it('does not re-state it for the canned Go-deeper string', async () => {
    const { continueThread } = await loadResolverWithGraph()
    const sent: unknown[] = []
    stubFetchCapturing(sent)

    await continueThread(
      makeAnnotation(),
      'Go deeper on this. Provide more detail and evidence.',
      makeEditorState(),
    )

    expect(promptOf(sent)).not.toContain('DOES NOT DEFINE')
  })

  it('still gives the follow-up the document context it needs', async () => {
    // Suppressing the guard must not gut the envelope — retrieval keys on
    // blockId/pos, not on the term argument, so context survives.
    const { continueThread } = await loadResolverWithGraph()
    const sent: unknown[] = []
    stubFetchCapturing(sent)

    await continueThread(makeAnnotation(), 'how are they identified?', makeEditorState())

    const prompt = promptOf(sent)
    expect(prompt).toContain('Atlantis')
    expect(prompt).toContain('how are they identified?')
  })
})

describe('looksLikeTerm — why the obvious fix would have failed', () => {
  it('accepts a directive phrase as a term', () => {
    // Not a bug in looksLikeTerm: INTERROGATIVE_OPENERS holds wh-words and
    // auxiliaries, not directive verbs. It is a bug in any design that feeds
    // free-text follow-ups to it. Pinned so nobody "simplifies" continueThread
    // back into passing the follow-up text.
    expect(looksLikeTerm('elaborate on rate limiting')).toBe(true)
    expect(looksLikeTerm('clarify the retry logic')).toBe(true)
  })

  it('rejects an interrogative follow-up, which is what made the trap easy to miss', () => {
    expect(looksLikeTerm('how are they identified?')).toBe(false)
  })
})
