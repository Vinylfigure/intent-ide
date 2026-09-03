import { Plugin } from 'prosemirror-state'

/**
 * Cmd/Ctrl+click opens a link; a plain click keeps placing the caret.
 *
 * This is Notion's behaviour, and it is the convention for EDITABLE surfaces
 * generally — TipTap guards its own `openOnClick` on the editor's editable
 * state for the same reason. Plain-click-navigates belongs to read-only
 * rendering (which is why links in AI answers, rendered by Streamdown outside
 * contenteditable, can just be clicked). Inside a document you are editing, an
 * unmodified click has to keep meaning "put the cursor here", or selecting text
 * that happens to contain a link becomes a fight.
 *
 * Implemented on the DOM event rather than `handleClickOn` because the rendered
 * anchor already carries the href — no mark resolution needed, and it works
 * wherever the click lands inside the link, including on nested marks.
 */
export function createLinkClickPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        click(_view, event) {
          if (!event.metaKey && !event.ctrlKey) return false

          const target = event.target as HTMLElement | null
          const anchor = target?.closest?.('a[href]')
          const href = anchor?.getAttribute('href')
          if (!href) return false

          event.preventDefault()
          // noopener severs window.opener so the opened page cannot rewrite
          // this tab's location; a new tab also means a half-finished edit is
          // never navigated away from.
          window.open(href, '_blank', 'noopener,noreferrer')
          return true
        },
      },
    },
  })
}
