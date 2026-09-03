import { describe, it, expect } from 'vitest'
import { parseTextToDoc, parseHtmlToDoc, safeHref } from '../parser'
import type { Node as PMNode } from 'prosemirror-model'

// A document full of `[open resource](https://www.iso.org/standard/42001)`
// rendered as those literal characters. The schema always had the `link` mark —
// nothing ever created one, because this hand-rolled parser only understood
// bold, italic and code, and its "next special character" scan did not include
// `[`, so the opening bracket was never even a candidate.

/** Every (text, href) pair carrying a link mark, in document order. */
function links(doc: PMNode): Array<{ text: string; href: string }> {
  const out: Array<{ text: string; href: string }> = []
  doc.descendants((node) => {
    if (!node.isText) return
    const mark = node.marks.find((m) => m.type.name === 'link')
    if (mark) out.push({ text: node.text ?? '', href: mark.attrs.href as string })
  })
  return out
}

describe('parseTextToDoc — markdown links', () => {
  it('turns [text](url) into a real link mark', () => {
    const doc = parseTextToDoc('See [open resource](https://www.iso.org/standard/42001) for detail.')
    expect(links(doc)).toEqual([
      { text: 'open resource', href: 'https://www.iso.org/standard/42001' },
    ])
  })

  it('keeps the surrounding prose as ordinary text', () => {
    const doc = parseTextToDoc('See [the spec](https://example.com/a) for detail.')
    expect(doc.textContent).toBe('See the spec for detail.')
  })

  it('handles several links in one line', () => {
    const doc = parseTextToDoc('[one](https://a.example) and [two](https://b.example)')
    expect(links(doc).map((l) => l.href)).toEqual(['https://a.example', 'https://b.example'])
  })

  it('keeps marks inside the link label', () => {
    const doc = parseTextToDoc('[**bold** link](https://example.com)')
    const bolded = links(doc).find((l) => l.text === 'bold')
    expect(bolded).toBeDefined()
    doc.descendants((node) => {
      if (node.isText && node.text === 'bold') {
        expect(node.marks.map((m) => m.type.name).sort()).toEqual(['link', 'strong'])
      }
    })
  })

  it('refuses a javascript: URL, keeping it as visible text', () => {
    // A pasted document is untrusted input; an href is a script-execution
    // vector, so an unsafe scheme must never become a live link.
    const doc = parseTextToDoc('[click me](javascript:alert(1))')
    expect(links(doc)).toEqual([])
    expect(doc.textContent).toContain('[click me](javascript:alert(1))')
  })

  it('refuses a data: URL too', () => {
    const doc = parseTextToDoc('[x](data:text/html,<script>alert(1)</script>)')
    expect(links(doc)).toEqual([])
  })

  it('does not break on a bare bracket', () => {
    // The scan now stops at `[`, so text that merely contains one must still
    // come through whole rather than being truncated at the bracket.
    const doc = parseTextToDoc('An array [0] and a note [see below] with no link.')
    expect(doc.textContent).toBe('An array [0] and a note [see below] with no link.')
    expect(links(doc)).toEqual([])
  })

  it('leaves an unclosed link alone', () => {
    const doc = parseTextToDoc('An [unfinished link with no paren')
    expect(doc.textContent).toBe('An [unfinished link with no paren')
  })

  it('still parses bold, italic and code beside links', () => {
    const doc = parseTextToDoc('**b** *i* `c` and [l](https://example.com)')
    expect(doc.textContent).toBe('b i c and l')
    expect(links(doc)).toHaveLength(1)
  })
})

describe('parseHtmlToDoc — anchors', () => {
  it('keeps the href instead of dropping it', () => {
    // Previously every <a href> was swallowed by the generic tag strip.
    const doc = parseHtmlToDoc('<p>See <a href="https://example.com/spec">the spec</a> here.</p>')
    expect(links(doc)).toEqual([{ text: 'the spec', href: 'https://example.com/spec' }])
  })

  it('drops an anchor with no visible text rather than emitting empty brackets', () => {
    const doc = parseHtmlToDoc('<p>Before<a href="https://example.com"></a>After</p>')
    expect(doc.textContent).not.toContain('[]')
  })
})

describe('safeHref', () => {
  it('allows the schemes a document link legitimately uses', () => {
    expect(safeHref('https://example.com')).toBe('https://example.com')
    expect(safeHref('http://example.com')).toBe('http://example.com')
    expect(safeHref('mailto:someone@example.com')).toBe('mailto:someone@example.com')
  })

  it('refuses script-bearing schemes', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('JavaScript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,x')).toBeNull()
    expect(safeHref('vbscript:x')).toBeNull()
  })

  it('assumes https for a bare domain', () => {
    expect(safeHref('example.com/a')).toBe('https://example.com/a')
  })

  it('passes through in-document and root-relative targets', () => {
    expect(safeHref('#section-2')).toBe('#section-2')
    expect(safeHref('/docs/a')).toBe('/docs/a')
  })

  it('refuses empty and protocol-relative hrefs', () => {
    expect(safeHref('   ')).toBeNull()
    expect(safeHref('//evil.example')).toBeNull()
  })
})
