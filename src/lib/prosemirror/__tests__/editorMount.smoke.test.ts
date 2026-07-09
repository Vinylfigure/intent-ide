// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { Node as PMNode } from 'prosemirror-model'
import { schema } from '../schema'
import { createBlockIdPlugin } from '../plugins/blockIdPlugin'
import { collectBlocks } from '../blockIds'

/**
 * Mount smoke test — the one gate the unit pyramid cannot provide.
 *
 * Regression: plugin view() hooks run synchronously inside the EditorView
 * constructor. EditorShell's dispatchTransaction closes over the `const view`
 * being constructed, so any plugin that dispatches from its view() hook
 * crashes every mount with a TDZ ReferenceError — while every headless
 * EditorState test stays green. This test constructs a REAL EditorView with
 * the exact dispatchTransaction shape EditorShell uses.
 */

function legacyDoc(): PMNode {
  return PMNode.fromJSON(schema, {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'legacy unstamped paragraph' }] },
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'legacy title' }] },
    ],
  })
}

function mount(doc: PMNode): EditorView {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const state = EditorState.create({ schema, doc, plugins: [createBlockIdPlugin()] })
  // EXACT EditorShell shape: dispatchTransaction closes over `const view`.
  const view: EditorView = new EditorView(host, {
    state,
    dispatchTransaction(transaction) {
      const newState = view.state.apply(transaction)
      view.updateState(newState)
    },
  })
  return view
}

async function microtasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('editor mount smoke (jsdom)', () => {
  it('mounts with an unstamped legacy doc without throwing, then stamps it', async () => {
    const view = mount(legacyDoc())
    try {
      expect(collectBlocks(view.state.doc).every((b) => b.blockId === null)).toBe(true)
      await microtasks()
      const blocks = collectBlocks(view.state.doc)
      expect(blocks.length).toBeGreaterThan(0)
      expect(blocks.every((b) => b.blockId !== null)).toBe(true)
    } finally {
      view.destroy()
    }
  })

  it('mounts with a brand-new empty doc without throwing', async () => {
    const empty = schema.topNodeType.createAndFill()!
    const view = mount(empty)
    try {
      await microtasks()
      expect(collectBlocks(view.state.doc).every((b) => b.blockId !== null)).toBe(true)
    } finally {
      view.destroy()
    }
  })

  it('destroying the view before the deferred stamp runs does not throw', async () => {
    const view = mount(legacyDoc())
    view.destroy()
    await microtasks() // deferred stamp must observe isDestroyed and bail
  })
})
