import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  extractMermaidFence,
  validateMermaid,
  degradeMermaidToProse,
  ensureRenderableMermaid,
} from '../mermaidGuard'

// The guard treats `typeof window === 'undefined'` as "cannot parse — pass".
// To exercise real validation in this node-env test, stub a window global and
// mock the mermaid module: parse succeeds only for source containing
// 'graph TD', everything else throws.
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn(async (code: string) => {
      if (code.includes('graph TD')) return true
      throw new Error('Parse error on line 1: bad syntax')
    }),
  },
}))

const VALID = 'graph TD\n  A --> B'
const INVALID = 'grph TDD\n  A -> ->'

const fenced = (code: string, lang = 'mermaid', fence = '```') =>
  `Intro text.\n\n${fence}${lang}\n${code}\n${fence}\n\nCaption sentence.`

describe('extractMermaidFence', () => {
  it('extracts the code from a ```mermaid fence', () => {
    const match = extractMermaidFence(fenced(VALID))
    expect(match).not.toBeNull()
    expect(match!.code).toBe(VALID)
    expect(match!.fence).toContain('```mermaid')
  })

  it('extracts from a ~~~mermaid fence', () => {
    const match = extractMermaidFence(fenced(VALID, 'mermaid', '~~~'))
    expect(match).not.toBeNull()
    expect(match!.code).toBe(VALID)
  })

  it('returns the FIRST fence when multiple exist', () => {
    const content = `${fenced('graph TD\n  A --> B')}\n\n${fenced('graph TD\n  C --> D')}`
    const match = extractMermaidFence(content)
    expect(match!.code).toContain('A --> B')
    expect(match!.code).not.toContain('C --> D')
  })

  it('matches a fence at the very start of content', () => {
    const match = extractMermaidFence('```mermaid\ngraph TD\n  A --> B\n```')
    expect(match).not.toBeNull()
  })

  it('returns null when there is no fence', () => {
    expect(extractMermaidFence('Just prose, no diagrams here.')).toBeNull()
  })

  it('returns null for non-mermaid fences', () => {
    expect(extractMermaidFence('```js\nconst x = 1\n```')).toBeNull()
  })

  it('returns null for an unterminated mermaid fence', () => {
    expect(extractMermaidFence('```mermaid\ngraph TD\n  A --> B')).toBeNull()
  })
})

describe('validateMermaid', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes valid source', async () => {
    await expect(validateMermaid(VALID)).resolves.toEqual({ ok: true })
  })

  it('fails invalid source with the parse error text', async () => {
    const result = await validateMermaid(INVALID)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('bad syntax')
  })

  it('is SSR/node-safe: passes without a window global', async () => {
    vi.unstubAllGlobals()
    await expect(validateMermaid(INVALID)).resolves.toEqual({ ok: true })
  })
})

describe('degradeMermaidToProse', () => {
  it('swaps only the fence language, leaving everything else intact', () => {
    const content = fenced(INVALID)
    const degraded = degradeMermaidToProse(content)
    expect(degraded).not.toContain('```mermaid')
    expect(degraded).toContain('```\n' + INVALID)
    expect(degraded).toContain('Intro text.')
    expect(degraded).toContain('Caption sentence.')
    expect(degraded).toContain(INVALID)
  })

  it('degrades ~~~ fences too', () => {
    const degraded = degradeMermaidToProse(fenced(INVALID, 'mermaid', '~~~'))
    expect(degraded).not.toContain('~~~mermaid')
    expect(degraded).toContain('~~~\n' + INVALID)
  })

  it('leaves content without mermaid fences untouched', () => {
    const content = 'Prose.\n\n```js\nconst x = 1\n```'
    expect(degradeMermaidToProse(content)).toBe(content)
  })
})

describe('ensureRenderableMermaid', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns content unchanged (no retry) when there is no fence', async () => {
    const retry = vi.fn()
    const content = 'No diagram here.'
    await expect(ensureRenderableMermaid(content, retry)).resolves.toBe(content)
    expect(retry).not.toHaveBeenCalled()
  })

  it('returns content unchanged (no retry) when the fence validates', async () => {
    const retry = vi.fn()
    const content = fenced(VALID)
    await expect(ensureRenderableMermaid(content, retry)).resolves.toBe(content)
    expect(retry).not.toHaveBeenCalled()
  })

  it('invalid → valid retry: retry content is used, retry called exactly once', async () => {
    const corrected = fenced(VALID)
    const retry = vi.fn(async (_error: string) => corrected)
    const result = await ensureRenderableMermaid(fenced(INVALID), retry)
    expect(result).toBe(corrected)
    expect(retry).toHaveBeenCalledTimes(1)
    expect(retry.mock.calls[0][0]).toContain('bad syntax')
  })

  it('invalid → retry without a fence: retry prose is used as-is', async () => {
    const retry = vi.fn(async () => 'Sorry, here is a plain-prose explanation instead.')
    const result = await ensureRenderableMermaid(fenced(INVALID), retry)
    expect(result).toBe('Sorry, here is a plain-prose explanation instead.')
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('invalid → invalid retry: degrades the ORIGINAL, retry called exactly once', async () => {
    const retry = vi.fn(async () => fenced('still broken', 'mermaid'))
    const original = fenced(INVALID)
    const result = await ensureRenderableMermaid(original, retry)
    expect(retry).toHaveBeenCalledTimes(1)
    expect(result).toBe(degradeMermaidToProse(original))
    expect(result).toContain(INVALID)
    expect(result).not.toContain('still broken')
    expect(result).not.toContain('```mermaid')
  })

  it('a throwing retry degrades the original', async () => {
    const retry = vi.fn(async () => {
      throw new Error('resolver down')
    })
    const original = fenced(INVALID)
    const result = await ensureRenderableMermaid(original, retry)
    expect(result).toBe(degradeMermaidToProse(original))
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
