import { describe, it, expect } from 'vitest'
import { extractBlocks } from '@/components/ui/AgentMarkdown'

// extractBlocks is imported from the source. It used to be copied in here
// "verbatim", which meant the copy could drift and keep passing while the real
// renderer broke — so it is imported now, not re-implemented.
//
// splitIntoBlocks below IS still a local re-implementation, and no longer
// corresponds to anything in AgentMarkdown.tsx: the source function it mirrored
// has since been deleted. Those cases now test only themselves.

// ---------------------------------------------------------------------------
// Source-faithful re-implementations
// ---------------------------------------------------------------------------


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
      flush()
      continue
    }
    current.push(line)
  }
  flush()
  return blocks
}

// ---------------------------------------------------------------------------
// splitIntoBlocks
// ---------------------------------------------------------------------------

describe('splitIntoBlocks — happy path', () => {
  it('splits two paragraphs separated by a double newline', () => {
    const input = 'First paragraph.\n\nSecond paragraph.'
    expect(splitIntoBlocks(input)).toEqual(['First paragraph.', 'Second paragraph.'])
  })

  it('splits three paragraphs', () => {
    const input = 'Para one.\n\nPara two.\n\nPara three.'
    expect(splitIntoBlocks(input)).toEqual(['Para one.', 'Para two.', 'Para three.'])
  })

  it('trims leading and trailing whitespace from each block', () => {
    const input = '  First block.  \n\n  Second block.  '
    const result = splitIntoBlocks(input)
    expect(result[0]).toBe('First block.')
    expect(result[1]).toBe('Second block.')
  })
})

describe('splitIntoBlocks — empty block filtering', () => {
  it('filters out empty blocks from triple newlines', () => {
    const input = 'Block one.\n\n\nBlock two.'
    // The triple newline creates an empty segment — it should be removed
    const result = splitIntoBlocks(input)
    expect(result).toHaveLength(2)
    expect(result).toEqual(['Block one.', 'Block two.'])
  })

  it('filters out whitespace-only blocks', () => {
    const input = 'Block one.\n\n   \n\nBlock two.'
    const result = splitIntoBlocks(input)
    expect(result).toHaveLength(2)
    expect(result).toEqual(['Block one.', 'Block two.'])
  })

  it('returns empty array for completely empty string', () => {
    expect(splitIntoBlocks('')).toEqual([])
  })

  it('returns empty array for whitespace-only string', () => {
    expect(splitIntoBlocks('   \n\n   ')).toEqual([])
  })

  it('returns empty array for only newlines', () => {
    expect(splitIntoBlocks('\n\n\n\n')).toEqual([])
  })
})

describe('splitIntoBlocks — single block', () => {
  it('returns a single-element array when there are no double newlines', () => {
    const input = 'This is a single block with no paragraph breaks.'
    expect(splitIntoBlocks(input)).toEqual(['This is a single block with no paragraph breaks.'])
  })

  it('does NOT split on a single newline', () => {
    const input = 'Line one.\nLine two.'
    const result = splitIntoBlocks(input)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe('Line one.\nLine two.')
  })
})

describe('splitIntoBlocks — markdown content', () => {
  it('splits paragraphs interspersed with bullet lists', () => {
    const input = 'Intro paragraph.\n\n- Item one\n- Item two\n\nConclusion.'
    const result = splitIntoBlocks(input)
    expect(result).toHaveLength(3)
    expect(result[0]).toBe('Intro paragraph.')
    expect(result[1]).toBe('- Item one\n- Item two')
    expect(result[2]).toBe('Conclusion.')
  })

  it('handles markdown headings as blocks', () => {
    const input = '## Section title\n\nParagraph under section.'
    const result = splitIntoBlocks(input)
    expect(result).toEqual(['## Section title', 'Paragraph under section.'])
  })

  it('handles code fences without splitting inside them', () => {
    const input = 'Before code.\n\n```\nconst x = 1\n```\n\nAfter code.'
    const result = splitIntoBlocks(input)
    // The code block itself has single-newlines inside; only paragraph-level split applies
    expect(result[0]).toBe('Before code.')
    expect(result[1]).toContain('const x = 1')
    expect(result[2]).toBe('After code.')
  })
})

describe('splitIntoBlocks — fence awareness', () => {
  it('a fence containing blank lines stays one block', () => {
    const input = '```mermaid\ngraph TD\n\n  A --> B\n\n  B --> C\n```'
    const result = splitIntoBlocks(input)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(input)
  })

  it('text / fence-with-blank-lines / text → 3 blocks', () => {
    const fence = '```mermaid\ngraph TD\n\n  A --> B\n```'
    const input = `Intro.\n\n${fence}\n\nOutro.`
    const result = splitIntoBlocks(input)
    expect(result).toHaveLength(3)
    expect(result[0]).toBe('Intro.')
    expect(result[1]).toBe(fence)
    expect(result[2]).toBe('Outro.')
  })

  it('an unterminated fence swallows the rest as one block', () => {
    const input = 'Intro.\n\n```mermaid\ngraph TD\n\n  A --> B\n\nNever closed.'
    const result = splitIntoBlocks(input)
    expect(result).toHaveLength(2)
    expect(result[0]).toBe('Intro.')
    expect(result[1]).toBe('```mermaid\ngraph TD\n\n  A --> B\n\nNever closed.')
  })

  it('~~~ fences are respected too', () => {
    const input = 'Before.\n\n~~~\nline one\n\nline two\n~~~\n\nAfter.'
    const result = splitIntoBlocks(input)
    expect(result).toHaveLength(3)
    expect(result[1]).toBe('~~~\nline one\n\nline two\n~~~')
  })
})

describe('splitIntoBlocks — boundary / stress', () => {
  it('handles very long single paragraph without splitting', () => {
    const longParagraph = 'word '.repeat(500).trim()
    const result = splitIntoBlocks(longParagraph)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(longParagraph)
  })

  it('handles many paragraphs (100)', () => {
    const paras = Array.from({ length: 100 }, (_, i) => `Paragraph ${i + 1}.`)
    const input = paras.join('\n\n')
    const result = splitIntoBlocks(input)
    expect(result).toHaveLength(100)
    expect(result[0]).toBe('Paragraph 1.')
    expect(result[99]).toBe('Paragraph 100.')
  })

  it('splits on four or more consecutive newlines', () => {
    const input = 'Block A.\n\n\n\nBlock B.'
    const result = splitIntoBlocks(input)
    expect(result).toHaveLength(2)
    expect(result).toEqual(['Block A.', 'Block B.'])
  })

  it('handles content that contains XSS payload — no special treatment', () => {
    // splitIntoBlocks is purely string-splitting; it should never transform content
    const input = '<script>alert("xss")</script>\n\nNormal paragraph.'
    const result = splitIntoBlocks(input)
    // The raw script tag must survive unchanged (rendering safety is Streamdown's responsibility)
    expect(result[0]).toBe('<script>alert("xss")</script>')
    expect(result[1]).toBe('Normal paragraph.')
  })
})

// ---------------------------------------------------------------------------
// extractBlocks
// ---------------------------------------------------------------------------

describe('extractBlocks — <chain-of-thought> extraction', () => {
  it('extracts debate log from <chain-of-thought> tags', () => {
    const input = '<chain-of-thought>Agent A says yes. Agent B says no.</chain-of-thought>\n\nFinal answer.'
    const { debateLog, body } = extractBlocks(input)
    expect(debateLog).toBe('Agent A says yes. Agent B says no.')
    expect(body).toBe('Final answer.')
  })

  it('removes the <chain-of-thought> block from body', () => {
    const input = 'Prefix.\n\n<chain-of-thought>debate</chain-of-thought>\n\nSuffix.'
    const { body } = extractBlocks(input)
    expect(body).not.toContain('<chain-of-thought>')
    expect(body).not.toContain('debate')
  })

  it('is case-insensitive for the chain-of-thought tag', () => {
    const input = '<Chain-Of-Thought>content</Chain-Of-Thought>\n\nBody.'
    const { debateLog, body } = extractBlocks(input)
    expect(debateLog).toBe('content')
    expect(body).toBe('Body.')
  })

  it('sets debateLog to null when tag is absent', () => {
    const { debateLog } = extractBlocks('No debate here.')
    expect(debateLog).toBeNull()
  })
})

describe('extractBlocks — <thinking> extraction', () => {
  it('extracts reasoning from <thinking> tags', () => {
    const input = '<thinking>I should consider both sides.</thinking>\n\nHere is my answer.'
    const { reasoning, body } = extractBlocks(input)
    expect(reasoning).toBe('I should consider both sides.')
    expect(body).toBe('Here is my answer.')
  })

  it('removes the <thinking> block from body', () => {
    const input = 'Start.\n\n<thinking>internal</thinking>\n\nEnd.'
    const { body } = extractBlocks(input)
    expect(body).not.toContain('<thinking>')
    expect(body).not.toContain('internal')
  })

  it('is case-insensitive for the thinking tag', () => {
    const input = '<THINKING>reasoning</THINKING>\n\nAnswer.'
    const { reasoning } = extractBlocks(input)
    expect(reasoning).toBe('reasoning')
  })

  it('sets reasoning to null when tag is absent', () => {
    const { reasoning } = extractBlocks('No thinking block here.')
    expect(reasoning).toBeNull()
  })
})

describe('extractBlocks — REASONING: prefix extraction', () => {
  it('extracts reasoning from REASONING: prefix at start of body', () => {
    const input = 'REASONING: This is why I think so.\n\nActual answer here.'
    const { reasoning, body } = extractBlocks(input)
    expect(reasoning).toBe('This is why I think so.')
    expect(body).toBe('Actual answer here.')
  })

  it('does not extract REASONING: prefix if <thinking> was already found', () => {
    const input = '<thinking>from tag</thinking>\n\nREASONING: should be ignored.\n\nBody.'
    const { reasoning, body } = extractBlocks(input)
    // reasoning comes from <thinking>, not the REASONING: prefix
    expect(reasoning).toBe('from tag')
    // REASONING: prefix remains in body since reasoning is already set
    expect(body).toContain('REASONING:')
  })

  it('is case-insensitive for REASONING: prefix', () => {
    const input = 'reasoning: lower-case.\n\nBody text.'
    const { reasoning } = extractBlocks(input)
    expect(reasoning).toBe('lower-case.')
  })

  it('sets reasoning to null for REASONING: prefix not at start', () => {
    // The regex is anchored with ^, so mid-body REASONING: is not extracted
    const input = 'Some text first.\n\nREASONING: not at start.'
    const { reasoning } = extractBlocks(input)
    expect(reasoning).toBeNull()
  })
})

describe('extractBlocks — combined tags', () => {
  it('extracts both <chain-of-thought> and <thinking> simultaneously', () => {
    const input = [
      '<chain-of-thought>debate log here</chain-of-thought>',
      '<thinking>my reasoning</thinking>',
      'The actual response.',
    ].join('\n\n')
    const { debateLog, reasoning, body } = extractBlocks(input)
    expect(debateLog).toBe('debate log here')
    expect(reasoning).toBe('my reasoning')
    expect(body).toBe('The actual response.')
  })

  it('handles content with no special blocks — passes through unchanged', () => {
    const plain = 'This is just a plain response with no special blocks.'
    const { reasoning, debateLog, body } = extractBlocks(plain)
    expect(reasoning).toBeNull()
    expect(debateLog).toBeNull()
    expect(body).toBe(plain)
  })

  it('handles empty string gracefully', () => {
    const { reasoning, debateLog, body } = extractBlocks('')
    expect(reasoning).toBeNull()
    expect(debateLog).toBeNull()
    expect(body).toBe('')
  })
})

describe('extractBlocks — multiline content in tags', () => {
  it('captures multi-line debate log', () => {
    const debateContent = 'Agent A: yes.\nAgent B: no.\nAgent A: convince me.'
    const input = `<chain-of-thought>${debateContent}</chain-of-thought>\n\nConclusion.`
    const { debateLog } = extractBlocks(input)
    expect(debateLog).toBe(debateContent)
  })

  it('captures multi-line thinking', () => {
    const thinkingContent = 'Step 1: consider scope.\nStep 2: evaluate options.\nStep 3: decide.'
    const input = `<thinking>${thinkingContent}</thinking>\n\nFinal answer.`
    const { reasoning } = extractBlocks(input)
    expect(reasoning).toBe(thinkingContent)
  })
})

describe('extractBlocks — malformed / adversarial inputs', () => {
  it('does not extract unclosed chain-of-thought tag', () => {
    const input = '<chain-of-thought>never closed'
    const { debateLog, body } = extractBlocks(input)
    // Without the closing tag, the regex does not match
    expect(debateLog).toBeNull()
    expect(body).toBe('<chain-of-thought>never closed')
  })

  it('treats an unclosed thinking tag as reasoning, not as the answer', () => {
    // Behaviour deliberately reversed. This used to assert the tag was left
    // alone, which meant a stream that ended mid-reasoning rendered the model's
    // deliberation to the user as if it were the answer.
    const input = '<thinking>no closing tag'
    const { reasoning, body } = extractBlocks(input)
    expect(reasoning).toBe('no closing tag')
    expect(body).toBe('')
  })

  it('extracts qwen3-style <think> reasoning, closed or not', () => {
    // Local thinking models emit <think>, not <thinking>. The Ollama dialect
    // sets think:false to stop it at the source; this is the second line of
    // defence for a model that ignores the flag.
    const closed = extractBlocks('<think>weighing it up</think>\n\nThe answer.')
    expect(closed.reasoning).toBe('weighing it up')
    expect(closed.body).toBe('The answer.')

    const unclosed = extractBlocks('<think>still weighing')
    expect(unclosed.reasoning).toBe('still weighing')
    expect(unclosed.body).toBe('')
  })

  it('does not treat a mismatched open/close pair as a matched block', () => {
    // <think>…</thinking> is not a real block; the backreference must not
    // let one tag name close the other.
    const { reasoning, body } = extractBlocks('<think>a</thinking>')
    expect(reasoning).toBe('a</thinking>')
    expect(body).toBe('')
  })

  it('handles nested angle-bracket content without matching partial tags', () => {
    // e.g. content that looks like an HTML tag but is inline code
    const input = 'Use `<div>` elements wisely.\n\nFollow-up paragraph.'
    const { reasoning, debateLog, body } = extractBlocks(input)
    expect(reasoning).toBeNull()
    expect(debateLog).toBeNull()
    // body must be returned untouched
    expect(body).toContain('<div>')
  })
})
