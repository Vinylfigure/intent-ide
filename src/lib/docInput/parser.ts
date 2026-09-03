import { schema } from '@/lib/prosemirror/schema'
import { Node } from 'prosemirror-model'

/**
 * Markdown-to-ProseMirror parser.
 * Handles headings, paragraphs, bold/italic/code inline marks,
 * bullet lists, ordered lists, blockquotes, code blocks, horizontal rules,
 * and native editable tables.
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

    // GFM pipe table. A real delimiter row is required, which keeps ordinary
    // prose containing pipes from being promoted to table structure.
    const parsedTable = parseMarkdownTable(lines, i)
    if (parsedTable) {
      nodes.push(parsedTable.node)
      i = parsedTable.nextLine
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
      !parseMarkdownTable(lines, i)
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

type CellAlignment = 'left' | 'center' | 'right' | null

export interface ParsedTable {
  node: Node
  nextLine: number
}

/** Split a pipe row without treating escaped pipes or pipes in code spans as separators. */
function splitTableRow(line: string): string[] | null {
  const source = line.trim()
  if (!source) return null

  const cells: string[] = []
  let cell = ''
  let escaped = false
  let codeFenceLength = 0
  let separatorCount = 0

  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (escaped) {
      cell += char === '|' ? '|' : `\\${char}`
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '`') {
      let run = 1
      while (source[index + run] === '`') run++
      if (codeFenceLength === 0) codeFenceLength = run
      else if (codeFenceLength === run) codeFenceLength = 0
      cell += '`'.repeat(run)
      index += run - 1
      continue
    }
    if (char === '|' && codeFenceLength === 0) {
      cells.push(cell.trim())
      cell = ''
      separatorCount++
      continue
    }
    cell += char
  }
  if (escaped) cell += '\\'
  cells.push(cell.trim())

  if (separatorCount === 0) return null
  if (source.startsWith('|')) cells.shift()
  if (source.endsWith('|') && !source.endsWith('\\|')) cells.pop()
  return cells.length > 0 ? cells : null
}

function parseDelimiterCell(cell: string): CellAlignment | undefined {
  const compact = cell.replace(/\s/g, '')
  if (!/^:?-{3,}:?$/.test(compact)) return undefined
  if (compact.startsWith(':') && compact.endsWith(':')) return 'center'
  if (compact.endsWith(':')) return 'right'
  if (compact.startsWith(':')) return 'left'
  return null
}

function createTableCell(type: 'table_header' | 'table_cell', text: string, align: CellAlignment): Node {
  const content = parseInlineMarks(text)
  const paragraph = schema.nodes.paragraph.create(null, content.length > 0 ? content : undefined)
  return schema.nodes[type].create({ align }, paragraph)
}

/**
 * Parse a complete GFM-style table beginning at `start`, or return null.
 *
 * Exported for the stored-document migration (`migrateTableBlocks.ts`), which
 * has to recognise the same table shape inside a legacy code_block.
 */
export function parseMarkdownTable(lines: string[], start: number): ParsedTable | null {
  if (start + 1 >= lines.length) return null
  const header = splitTableRow(lines[start])
  const delimiterCells = splitTableRow(lines[start + 1])
  if (!header || !delimiterCells || header.length !== delimiterCells.length) return null

  const alignments = delimiterCells.map(parseDelimiterCell)
  if (alignments.some((alignment) => alignment === undefined)) return null

  const bodyRows: string[][] = []
  let nextLine = start + 2
  while (nextLine < lines.length && lines[nextLine].trim() !== '') {
    const row = splitTableRow(lines[nextLine])
    if (!row) break
    bodyRows.push(row)
    nextLine++
  }

  // Preserve every imported cell. Wider body rows extend the table; shorter
  // rows are padded so the tableEditing plugin receives a valid rectangle.
  const columnCount = Math.max(header.length, ...bodyRows.map((row) => row.length))
  const paddedAlignments: CellAlignment[] = Array.from(
    { length: columnCount },
    (_, column) => (alignments[column] ?? null) as CellAlignment,
  )
  const pad = (row: string[]) => Array.from({ length: columnCount }, (_, column) => row[column] ?? '')

  const rows: Node[] = [
    schema.nodes.table_row.create(
      null,
      pad(header).map((cell, column) => createTableCell('table_header', cell, paddedAlignments[column])),
    ),
    ...bodyRows.map((row) =>
      schema.nodes.table_row.create(
        null,
        pad(row).map((cell, column) => createTableCell('table_cell', cell, paddedAlignments[column])),
      ),
    ),
  ]

  return { node: schema.nodes.table.create(null, rows), nextLine }
}

/**
 * Only these schemes may become a live link.
 *
 * A pasted document is untrusted input: `javascript:` and `data:` URLs in an
 * href are a script-execution vector, so they are kept as visible text instead.
 * Returns the href to use, or null to refuse.
 */
export function safeHref(href: string): string | null {
  const trimmed = href.trim()
  if (!trimmed) return null
  // Protocol-relative (`//host/...`) is refused: it carries no scheme to check
  // and silently inherits the page's, which in a pasted document is not a
  // decision the reader made. Checked BEFORE the root-relative branch, which
  // would otherwise swallow it on the leading slash.
  if (trimmed.startsWith('//')) return null
  // Root-relative and in-document targets have no scheme to validate.
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return trimmed
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)
  if (!scheme) return `https://${trimmed}`
  return ['http', 'https', 'mailto'].includes(scheme[1].toLowerCase()) ? trimmed : null
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

    // Link — [text](url)
    //
    // Markdown links used to fall straight through to the plain-text branch
    // below, because the "next special character" scan did not include `[`.
    // A document full of `[open resource](https://...)` rendered as those
    // literal characters, while the identical syntax inside an AI answer
    // rendered as a real link (answers go through Streamdown, which parses
    // markdown properly). The schema always had the `link` mark; nothing ever
    // created one.
    const linkMatch = remaining.match(/^\[([^\]]*)\]\(([^\s)]+)\)/)
    if (linkMatch) {
      const [whole, label, href] = linkMatch
      const safe = safeHref(href)
      if (safe) {
        // Marks inside the label still apply — `[**bold** link](url)` keeps
        // its bold.
        const inner = parseInlineMarks(label || safe)
        const linkMark = schema.marks.link.create({ href: safe })
        for (const node of inner) {
          nodes.push(node.mark([...node.marks, linkMark]))
        }
      } else {
        // An unsafe scheme is kept as visible text, never as a live link.
        nodes.push(schema.text(whole))
      }
      remaining = remaining.slice(whole.length)
      continue
    }

    // Inline code
    const codeMatch = remaining.match(/^`(.+?)`/)
    if (codeMatch) {
      nodes.push(schema.text(codeMatch[1], [schema.marks.code.create()]))
      remaining = remaining.slice(codeMatch[0].length)
      continue
    }

    // Find next special char. `[` belongs here — without it the scan ran past
    // the opening bracket of every link and the branch above never got a turn.
    const nextSpecial = remaining.search(/[\*`[]/)
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
    // Anchors -> markdown links, BEFORE the generic tag strip below eats them.
    // This function lowers HTML to markdown text and hands it to
    // parseTextToDoc, so turning them into `[text](url)` here is all it takes
    // for them to come out the other side as real link marks. Previously every
    // href was silently dropped.
    .replace(
      /<a[^>]*?href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_, href, label) => {
        const text = stripTags(label).trim()
        return text ? `[${text}](${href})` : ''
      },
    )
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
          .map(c => stripTags(c).trim().replace(/\|/g, '\\|'))
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
