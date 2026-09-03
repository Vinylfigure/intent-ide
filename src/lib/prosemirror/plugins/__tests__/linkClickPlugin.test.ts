// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { EditorView } from 'prosemirror-view'
import { createLinkClickPlugin } from '../linkClickPlugin'
import { detectUrl } from '@/lib/annotations/selectionOffers'

// Cmd/Ctrl+click opens; a plain click keeps placing the caret. That is Notion's
// behaviour and the convention for EDITABLE surfaces — plain-click-navigates
// belongs to read-only rendering. Inside a document you are editing, an
// unmodified click has to keep meaning "put the cursor here", or selecting text
// that happens to contain a link becomes a fight.

const plugin = createLinkClickPlugin()
const click = plugin.props.handleDOMEvents!.click as (
  view: EditorView,
  event: MouseEvent,
) => boolean

const view = {} as EditorView

function clickOn(html: string, mods: Partial<MouseEvent> = {}) {
  document.body.innerHTML = html
  const target = document.querySelector('a') ?? document.body
  const event = {
    target,
    metaKey: false,
    ctrlKey: false,
    preventDefault: vi.fn(),
    ...mods,
  } as unknown as MouseEvent
  return { handled: click(view, event), event }
}

const LINK = '<p>See <a href="https://example.com/spec">the spec</a></p>'

beforeEach(() => {
  vi.stubGlobal('open', vi.fn())
})

describe('linkClickPlugin', () => {
  it('opens the link on Cmd+click, in a new tab, severed from this one', () => {
    const { handled, event } = clickOn(LINK, { metaKey: true })
    expect(handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    // noopener stops the opened page rewriting this tab's location; a new tab
    // also means a half-finished edit is never navigated away from.
    expect(window.open).toHaveBeenCalledWith(
      'https://example.com/spec',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('opens on Ctrl+click too, for Windows and Linux', () => {
    expect(clickOn(LINK, { ctrlKey: true }).handled).toBe(true)
    expect(window.open).toHaveBeenCalled()
  })

  it('does nothing on a plain click, so the caret still lands', () => {
    const { handled, event } = clickOn(LINK)
    expect(handled).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(window.open).not.toHaveBeenCalled()
  })

  it('ignores a modified click that is not on a link', () => {
    const { handled } = clickOn('<p>ordinary prose</p>', { metaKey: true })
    expect(handled).toBe(false)
    expect(window.open).not.toHaveBeenCalled()
  })

  it('works when the click lands on a nested mark inside the link', () => {
    document.body.innerHTML = '<p><a href="https://example.com"><strong>bold link</strong></a></p>'
    const target = document.querySelector('strong')
    const event = {
      target, metaKey: true, ctrlKey: false, preventDefault: vi.fn(),
    } as unknown as MouseEvent
    expect(click(view, event)).toBe(true)
    expect(window.open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
  })
})

describe('detectUrl', () => {
  it('finds a URL so the selection bar can offer to open it', () => {
    expect(detectUrl('https://github.com/Vinylfigure/aegis-sentinel')).toBe(
      'https://github.com/Vinylfigure/aegis-sentinel',
    )
  })

  it('treats a bare domain as https only when it is the whole selection', () => {
    expect(detectUrl('example.com/docs')).toBe('https://example.com/docs')
    // Ordinary prose containing a full stop must not read as a hostname.
    expect(detectUrl('This is a sentence. It has two.')).toBeNull()
  })

  it('returns null for ordinary text', () => {
    expect(detectUrl('AIMS operating system')).toBeNull()
    expect(detectUrl('')).toBeNull()
  })

  it('stops at the punctuation that usually follows a URL in prose', () => {
    expect(detectUrl('see https://example.com/a) for more')).toBe('https://example.com/a')
  })
})
