import { schema } from '@/lib/prosemirror/schema'
import { Node } from 'prosemirror-model'

/**
 * Markdown-to-ProseMirror parser.
 * Handles headings, paragraphs, bold/italic/code inline marks,
 * bullet lists, ordered lists, blockquotes, code blocks, horizontal rules,
 * and tables (rendered as readable code blocks).
 */
export function parseTextToDoc(text: string): Node {
  const lines = text.split('\n')
  const nodes: Node[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Empty line → skip
    if (line.trim() === '') {
      i++
      continue
    }

    // Heading detection
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const inlineNodes = parseInlineMarks(headingMatch[2])
      nodes.push(schema.nodes.heading.create({ level }, inlineNodes))
      i++
      continue
    }

    // Code block (fenced)
    if (line.startsWith('```')) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      if (i < lines.length) i++ // Skip closing ```
      const codeText = codeLines.join('\n')
      nodes.push(
        schema.nodes.code_block.create(
          null,
          codeText ? schema.text(codeText) : undefined
        )
      )
      continue
    }

    // Horizontal rule
    if (line.match(/^(-{3,}|\*{3,}|_{3,})\s*$/)) {
      nodes.push(schema.nodes.horizontal_rule.create())
      i++
      continue
    }

    // Table detection (pipe-formatted: | col | col |)
    if (line.match(/^\|(.+)\|/) && i + 1 < lines.length && lines[i + 1].match(/^\|[-:\s|]+\|/)) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].match(/^\|(.+)\|/)) {
        tableLines.push(lines[i])
        i++
      }
      // Render table as a readable code block (lightweight editor, no full table support)
      const tableText = tableLines.join('\n')
      nodes.push(
        schema.nodes.code_block.create(null, schema.text(tableText))
      )
      continue
    }

    // Blockquote (may span multiple lines)
    if (line.startsWith('> ') || line === '>') {
      const quoteParas: Node[] = []
      const quotePara: string[] = []
      while (i < lines.length && (lines[i].startsWith('> ') || lines[i] === '>' || lines[i].startsWith('>'))) {
        const content = lines[i].replace(/^>\s?/, '')
        if (content.trim() === '' && quotePara.length > 0) {
          quoteParas.push(
            schema.nodes.paragraph.create(null, parseInlineMarks(quotePara.join(' ')))
          )
          quotePara.length = 0
        } else if (content.trim() !== '') {
          quotePara.push(content)
        }
        i++
      }
      if (quotePara.length > 0) {
        quoteParas.push(
          schema.nodes.paragraph.create(null, parseInlineMarks(quotePara.join(' ')))
        )
      }
      if (quoteParas.length === 0) {
        quoteParas.push(schema.nodes.paragraph.create())
      }
      nodes.push(schema.nodes.blockquote.create(null, quoteParas))
      continue
    }

    // Bullet list (-, *, +)
    if (line.match(/^[\s]*[-*+]\s+/)) {
      const items: Node[] = []
      while (i < lines.length && lines[i].match(/^[\s]*[-*+]\s+/)) {
        const itemText = lines[i].replace(/^[\s]*[-*+]\s+/, '')
        const inlineNodes = parseInlineMarks(itemText)
        items.push(
          schema.nodes.list_item.create(
            null,
            schema.nodes.paragraph.create(null, inlineNodes)
          )
        )
        i++
        // Collect continuation lines (indented, not a new list item)
        while (i < lines.length && lines[i].match(/^\s{2,}/) && !lines[i].match(/^[\s]*[-*+]\s+/) && !lines[i].match(/^[\s]*\d+[.)]\s+/)) {
          // Append to last item's paragraph (simplified — just join text)
          const contText = lines[i].trim()
          if (contText && items.length > 0) {
            const lastItem = items[items.length - 1]
            const lastPara = lastItem.lastChild
            if (lastPara) {
              const combined = lastPara.textContent + ' ' + contText
              items[items.length - 1] = schema.nodes.list_item.create(
                null,
                schema.nodes.paragraph.create(null, parseInlineMarks(combined))
              )
            }
          }
          i++
        }
      }
      nodes.push(schema.nodes.bullet_list.create(null, items))
      continue
    }

    // Ordered list (1. or 1))
    if (line.match(/^[\s]*\d+[.)]\s+/)) {
      const items: Node[] = []
      while (i < lines.length && lines[i].match(/^[\s]*\d+[.)]\s+/)) {
        const itemText = lines[i].replace(/^[\s]*\d+[.)]\s+/, '')
        const inlineNodes = parseInlineMarks(itemText)
        items.push(
          schema.nodes.list_item.create(
            null,
            schema.nodes.paragraph.create(null, inlineNodes)
          )
        )
        i++
        // Collect continuation lines
        while (i < lines.length && lines[i].match(/^\s{2,}/) && !lines[i].match(/^[\s]*\d+[.)]\s+/) && !lines[i].match(/^[\s]*[-*+]\s+/)) {
          const contText = lines[i].trim()
          if (contText && items.length > 0) {
            const lastItem = items[items.length - 1]
            const lastPara = lastItem.lastChild
            if (lastPara) {
              const combined = lastPara.textContent + ' ' + contText
              items[items.length - 1] = schema.nodes.list_item.create(
                null,
                schema.nodes.paragraph.create(null, parseInlineMarks(combined))
              )
            }
          }
          i++
        }
      }
      nodes.push(schema.nodes.ordered_list.create(null, items))
      continue
    }

    // Regular paragraph — collect consecutive non-special lines
    const paraLines: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].startsWith('```') &&
      !lines[i].startsWith('> ') &&
      !lines[i].match(/^[\s]*[-*+]\s+/) &&
      !lines[i].match(/^[\s]*\d+[.)]\s+/) &&
      !lines[i].match(/^(-{3,}|\*{3,}|_{3,})\s*$/) &&
      !lines[i].match(/^\|(.+)\|/)
    ) {
      paraLines.push(lines[i])
      i++
    }

    const paraText = paraLines.join(' ')
    const inlineNodes = parseInlineMarks(paraText)
    nodes.push(schema.nodes.paragraph.create(null, inlineNodes))
  }

  if (nodes.length === 0) {
    nodes.push(schema.nodes.paragraph.create())
  }

  return schema.nodes.doc.create(null, nodes)
}

function parseInlineMarks(text: string): Node[] {
  const nodes: Node[] = []
  let remaining = text

  while (remaining.length > 0) {
    // Bold
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/)
    if (boldMatch) {
      nodes.push(schema.text(boldMatch[1], [schema.marks.strong.create()]))
      remaining = remaining.slice(boldMatch[0].length)
      continue
    }

    // Italic
    const italicMatch = remaining.match(/^\*(.+?)\*/)
    if (italicMatch) {
      nodes.push(schema.text(italicMatch[1], [schema.marks.em.create()]))
      remaining = remaining.slice(italicMatch[0].length)
      continue
    }

    // Inline code
    const codeMatch = remaining.match(/^`(.+?)`/)
    if (codeMatch) {
      nodes.push(schema.text(codeMatch[1], [schema.marks.code.create()]))
      remaining = remaining.slice(codeMatch[0].length)
      continue
    }

    // Find next special char
    const nextSpecial = remaining.search(/[\*`]/)
    if (nextSpecial > 0) {
      nodes.push(schema.text(remaining.slice(0, nextSpecial)))
      remaining = remaining.slice(nextSpecial)
    } else {
      nodes.push(schema.text(remaining))
      remaining = ''
    }
  }

  return nodes
}

// Convert HTML to plain text preserving structure
export function parseHtmlToDoc(html: string): Node {
  let text = html
    // Remove script and style blocks entirely
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // Convert headings
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `\n# ${stripTags(t)}\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `\n## ${stripTags(t)}\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `\n### ${stripTags(t)}\n`)
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, t) => `\n#### ${stripTags(t)}\n`)
    .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, t) => `\n##### ${stripTags(t)}\n`)
    .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, t) => `\n###### ${stripTags(t)}\n`)
    // Tables: convert <tr>/<td> to pipe format
    .replace(/<table[\s\S]*?<\/table>/gi, (tableHtml) => {
      const rows: string[] = []
      const rowMatches = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) || []
      rowMatches.forEach((row, idx) => {
        const cells = (row.match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi) || [])
          .map(c => stripTags(c).trim())
        rows.push('| ' + cells.join(' | ') + ' |')
        if (idx === 0) {
          rows.push('| ' + cells.map(() => '---').join(' | ') + ' |')
        }
      })
      return '\n' + rows.join('\n') + '\n'
    })
    // Lists: convert <ol>/<ul>/<li>
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
      let n = 0
      return inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_: string, content: string) => {
        n++
        return `${n}. ${stripTags(content).trim()}\n`
      })
    })
    .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) => {
      return inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_: string, content: string) => {
        return `- ${stripTags(content).trim()}\n`
      })
    })
    // Block elements -> newlines
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/blockquote>/gi, '\n')
    .replace(/<blockquote[^>]*>/gi, '\n> ')
    // Bold/italic
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
    // Code
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, t) => `\n\`\`\`\n${stripTags(t)}\n\`\`\`\n`)
    // Horizontal rules
    .replace(/<hr[^>]*\/?>/gi, '\n---\n')
    // Strip remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Collapse excessive blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return parseTextToDoc(text)
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim()
}

// Parse a file (markdown, plain text, or HTML)
export function parseFileToDoc(content: string, filename: string): Node {
  if (filename.endsWith('.html') || filename.endsWith('.htm')) {
    return parseHtmlToDoc(content)
  }
  // Markdown and plain text use the same parser
  return parseTextToDoc(content)
}
