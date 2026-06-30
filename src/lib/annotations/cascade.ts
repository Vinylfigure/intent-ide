import { EditorState } from 'prosemirror-state'

export interface CascadeFlag {
  from: number
  to: number
  text: string
  reason: string
}

export function checkCascade(
  changedText: string,
  newText: string,
  editorState: EditorState,
  changeFrom: number,
  readLinePos: number,
): CascadeFlag[] {
  const flags: CascadeFlag[] = []
  const doc = editorState.doc

  // Extract key terms from changed text (words > 3 chars)
  const keyTerms = changedText
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .map((w) => w.toLowerCase())

  if (keyTerms.length === 0) return flags

  // Scan paragraphs between changeFrom and readLinePos
  doc.nodesBetween(
    Math.min(changeFrom, readLinePos),
    Math.max(changeFrom, readLinePos),
    (node, pos) => {
      if (node.isBlock && node.textContent) {
        // Skip the changed block itself
        if (pos >= changeFrom && pos <= changeFrom + changedText.length) return

        const blockText = node.textContent.toLowerCase()
        const matchingTerms = keyTerms.filter((term) =>
          blockText.includes(term)
        )

        if (matchingTerms.length >= 2) {
          flags.push({
            from: pos,
            to: pos + node.nodeSize,
            text: node.textContent.slice(0, 100),
            reason: `References: ${matchingTerms.join(', ')}`,
          })
        }
      }
    }
  )

  return flags
}
