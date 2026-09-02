import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Annotation } from '@/lib/annotations/types'

// buildBranchChain reads the annotation store directly (it walks parentId
// links), so the store is the seam to fake — the functions under test are
// otherwise pure.
const store: { byId: Map<string, Annotation> } = { byId: new Map() }

vi.mock('@/stores/annotationStore', () => ({
  useAnnotationStore: {
    getState: () => ({ getById: (id: string) => store.byId.get(id) }),
  },
}))

const { buildBranchChain, formatBranchChain } = await import('@/lib/ai/intentContext')

function ann(
  id: string,
  parentId: string | null,
  opts: { transcript?: string; content?: string; sourceQuote?: string; anchorText?: string } = {},
): Annotation {
  return {
    id,
    parentId,
    transcript: opts.transcript ?? `question ${id}`,
    sourceQuote: opts.sourceQuote,
    anchor: { from: 0, to: 1, scope: 'phrase', text: opts.anchorText ?? `anchor ${id}` },
    resolution: opts.content === undefined ? null : { content: opts.content },
  } as unknown as Annotation
}

function seed(...annotations: Annotation[]) {
  store.byId = new Map(annotations.map((a) => [a.id, a]))
}

describe('buildBranchChain', () => {
  beforeEach(() => {
    store.byId = new Map()
  })

  it('is empty for a top-level annotation, so its prompt is unchanged', () => {
    seed(ann('a', null, { content: 'answer a' }))
    expect(buildBranchChain('a')).toEqual([])
    expect(formatBranchChain(buildBranchChain('a'))).toBe('')
  })

  it('walks ancestors nearest-first', () => {
    seed(
      ann('root', null, { transcript: 'why thirty days?', content: 'net-30 convention' }),
      ann('mid', 'root', { transcript: 'what is net-30?', content: 'due in 30 days' }),
      ann('leaf', 'mid'),
    )
    const chain = buildBranchChain('leaf')
    expect(chain.map((l) => l.question)).toEqual(['what is net-30?', 'why thirty days?'])
    expect(chain[0].conclusion).toBe('due in 30 days')
  })

  it('reports the quoted span as the subject when the ancestor had one', () => {
    seed(
      ann('root', null, { sourceQuote: 'principal', anchorText: 'Net-30 t', content: 'the capital sum' }),
      ann('leaf', 'root'),
    )
    expect(buildBranchChain('leaf')[0].subject).toBe('principal')
  })

  it('falls back to the document anchor when there is no quote', () => {
    seed(ann('root', null, { anchorText: 'Net-30 t', content: 'x' }), ann('leaf', 'root'))
    expect(buildBranchChain('leaf')[0].subject).toBe('Net-30 t')
  })

  it('skips ancestors that have not resolved yet', () => {
    seed(
      ann('root', null, { content: 'resolved' }),
      ann('mid', 'root'),
      ann('leaf', 'mid'),
    )
    expect(buildBranchChain('leaf')).toHaveLength(1)
  })

  it('caps depth so a deep rabbit-hole cannot flood the prompt', () => {
    const chainAnns = [ann('n0', null, { content: 'c0' })]
    for (let i = 1; i <= 10; i++) chainAnns.push(ann(`n${i}`, `n${i - 1}`, { content: `c${i}` }))
    seed(...chainAnns)
    expect(buildBranchChain('n10')).toHaveLength(4)
  })

  it('terminates on a cyclic parent chain instead of hanging', () => {
    const a = ann('a', 'b', { content: 'ca' })
    const b = ann('b', 'a', { content: 'cb' })
    seed(a, b)
    expect(buildBranchChain('a').length).toBeLessThanOrEqual(4)
  })

  it('terminates when a parent id points at a missing annotation', () => {
    seed(ann('leaf', 'ghost'))
    expect(buildBranchChain('leaf')).toEqual([])
  })
})

describe('formatBranchChain', () => {
  it('states the contradiction check as an instruction', () => {
    seed(ann('root', null, { content: 'due in 30 days' }), ann('leaf', 'root'))
    const rendered = formatBranchChain(buildBranchChain('leaf'))
    expect(rendered).toContain('You concluded: due in 30 days')
    expect(rendered).toContain('contradicts any conclusion above')
  })

  it('truncates a long conclusion rather than carrying it whole', () => {
    seed(ann('root', null, { content: 'x'.repeat(500) }), ann('leaf', 'root'))
    const rendered = formatBranchChain(buildBranchChain('leaf'))
    expect(rendered).toContain('…')
    // The cap is on the conclusion, not the whole block — the fixed
    // instruction text is always carried. Assert the payload shrank.
    expect(rendered).not.toContain('x'.repeat(300))
    expect(rendered).toContain('x'.repeat(100))
  })
})
