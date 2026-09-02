import { describe, it, expect } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { schema } from '../schema'
import { getBlockText, getSectionText, inferScope, inferScopeFromSelection } from '../helpers'
import { parseTextToDoc } from '@/lib/docInput/parser'

// helpers.ts had no coverage at all. It decides how much of the document the
// resolver sees for a given selection — which is to say it decides whether an
// answer is grounded — so the cases below are written against the exact
// document shape that produced a wrong answer: a term appearing inside a
// heading, with its explanation in the paragraph beneath.

const DOC_MD = [
  '## 1. GitHub branch-protection hardening',
  '',
  'Control objective, enforced platform configuration, monitoring, exceptions.',
  '',
  '## 2. Terraform / Atlantis "sniff test"',
  '',
  'The stated process was IaC, but engineers could apply Terraform locally.',
  '',
  'Best use: technical curiosity, reading the real system rather than the policy.',
  '',
  '## 3. Jira + Splunk access-grant reconciliation',
  '',
  'You pulled access evidence and approval-ticket data.',
  '',
].join('\n')

function stateOf(markdown = DOC_MD): EditorState {
  return EditorState.create({ doc: parseTextToDoc(markdown) })
}

/** Absolute position of the first occurrence of `needle` in the document. */
function posOf(state: EditorState, needle: string): number {
  let found = -1
  state.doc.descendants((node, pos) => {
    if (found !== -1) return false
    if (node.isText && node.text?.includes(needle)) {
      found = pos + (node.text.indexOf(needle) ?? 0)
      return false
    }
    return true
  })
  if (found === -1) throw new Error(`not found in fixture: ${needle}`)
  return found
}

describe('getSectionText — block separation', () => {
  it('separates blocks instead of concatenating them', () => {
    // The bug: textBetween's default joins blocks with NOTHING, so the heading
    // ran straight into its paragraph — `"sniff test"The stated process was
    // IaC` — and a small local model read the result as one malformed
    // sentence. A grounding failure wearing a formatting disguise.
    const state = stateOf()
    const text = getSectionText(state, posOf(state, 'Atlantis'))
    expect(text).not.toContain('testThe')
    expect(text).toContain('sniff test')
    expect(text).toContain('The stated process was IaC')
  })

  it('returns the whole section from its heading to the next one', () => {
    const state = stateOf()
    const text = getSectionText(state, posOf(state, 'Atlantis'))
    expect(text).toContain('Terraform / Atlantis')
    expect(text).toContain('Best use: technical curiosity')
    // The next section must not bleed in — that is what "scoped" means here.
    expect(text).not.toContain('Jira + Splunk')
    // Nor the previous one.
    expect(text).not.toContain('branch-protection hardening')
  })

  it('runs to the end of the document for the last section', () => {
    const state = stateOf()
    const text = getSectionText(state, posOf(state, 'approval-ticket'))
    expect(text).toContain('Jira + Splunk')
    expect(text).toContain('approval-ticket data')
  })
})

describe('getBlockText', () => {
  it('returns the containing block, not the whole section', () => {
    const state = stateOf()
    const text = getBlockText(state, posOf(state, 'Atlantis'))
    expect(text).toContain('Terraform / Atlantis')
    expect(text).not.toContain('The stated process was IaC')
  })

  it('clamps a position past the end of a shrunken document', () => {
    // Stored anchors outlive the text they pointed at; an unclamped resolve
    // would throw a RangeError instead of degrading.
    const state = stateOf()
    expect(() => getBlockText(state, state.doc.content.size + 500)).not.toThrow()
  })

  it('returns empty rather than the whole document for a position between blocks', () => {
    const state = stateOf()
    expect(getBlockText(state, 0)).toBe('')
  })
})

describe('inferScope — a selection touching a heading', () => {
  it('widens a word inside a heading to section scope', () => {
    // Selecting the single word "Atlantis" must not budget the answer as a
    // phrase: the explanation the reader wants lives in the section below it.
    const state = stateOf()
    const at = posOf(state, 'Atlantis')
    expect(inferScope(state, at, at + 'Atlantis'.length)).toBe('section')
  })

  it('keeps an ordinary in-paragraph word below section scope', () => {
    const state = stateOf()
    const at = posOf(state, 'Terraform locally')
    expect(inferScope(state, at, at + 'Terraform'.length)).not.toBe('section')
  })
})

describe('inferScopeFromSelection', () => {
  it('returns null for an empty selection', () => {
    const state = stateOf()
    expect(inferScopeFromSelection(state)).toBeNull()
  })

  it('reports the selected text and a heading nodeType for a heading selection', () => {
    const state = stateOf()
    const at = posOf(state, 'Atlantis')
    const selected = EditorState.create({ doc: state.doc }).apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, at, at + 'Atlantis'.length),
      ),
    )
    const result = inferScopeFromSelection(selected)
    expect(result?.text).toBe('Atlantis')
    expect(result?.scope).toBe('section')
    expect(result?.nodeType).toBe('heading')
  })
})
